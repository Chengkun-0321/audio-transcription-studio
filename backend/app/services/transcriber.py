"""MLX Whisper 轉錄：VAD 切段 + 分塊進度回報 + 繁體中文輸出。

流程（規格 §3.1/§3.2/§8）:
1. silero-vad 找出語音區間，切除長靜音 —— Whisper 靜音幻覺的主要防線
2. 語音區間合併成 <= CHUNK_SECONDS 的塊（只在停頓處切，不切斷字），逐塊丟給
   mlx-whisper，每塊完成即回報進度（真實進度，非動畫）
3. 時間戳映射回原始時間軸；濾掉字幕殘留幻覺句與重複迴圈；中文結果用 OpenCC s2twp 轉繁體

刻意不用的 Whisper 選項（實測 large-v3 會議錄音）：
- initial_prompt 帶上一塊結尾：推理慢 2.6 倍、句子黏成 30 秒一段，還把上一塊的錯字帶進下一塊
- hallucination_silence_threshold：會整句漏掉真實的短語音、慢 15%；靜音幻覺已由 VAD 處理
"""
from __future__ import annotations

import gc
import re
from itertools import groupby
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from ..config import MLX_CACHE_LIMIT_MB
from .audio import SAMPLE_RATE, to_tensor

CHUNK_SECONDS = 120.0   # 進度粒度與單次推理長度的折衷
MAX_GAP = 30.0          # 塊內允許的最長靜音；更長就另起一塊（長靜音直接跳過不轉錄）
PAD = 0.25              # 語音段前後保留，避免 VAD 切掉字頭字尾
QUIET_SEARCH = 10.0     # 不得不在語音中切塊時，在塊尾這麼多秒內找最安靜處下刀
REPEAT_RUN = 3          # 連續這麼多句完全相同視為重複迴圈，只留第一句
REPEAT_MIN_CHARS = 5    # 短於此字數的句子（嗯、對、好）重複是正常的，不處理

# Whisper 訓練資料（影片字幕）殘留的製作者署名：非口語內容，出現必為幻覺。
# 「謝謝觀看」「請訂閱」這類也可能是真的口語，不列入。
_CREDIT_RE = re.compile(
    r"明[鏡镜][與与]點點|點點欄目|点点栏目|Amara\.org|優優獨播|优优独播|"
    r"字幕志[願愿]者|中文字幕.{0,6}(提供|製作|制作)",
    re.IGNORECASE,
)

_vad = None


def _get_vad():
    """延遲載入 silero-vad（模型隨 pip 套件內建，非 HF 下載），回傳 (model, get_speech_timestamps)。

    注意 silero_vad import 時會 torch.set_num_threads(1)（全域）：同一 process 內其他
    torch 運算都會變單執行緒，這也是 pyannote 放在子行程跑的原因之一。
    """
    global _vad
    if _vad is None:
        from silero_vad import get_speech_timestamps, load_silero_vad
        _vad = (load_silero_vad(), get_speech_timestamps)
    return _vad


def _quiet_cut(audio: np.ndarray, start: int, end: int) -> list[tuple[int, int]]:
    """把 [start, end) 切成不超過 CHUNK_SECONDS 的片段。

    切點選在每塊結尾前 QUIET_SEARCH 秒內最安靜的 0.1 秒（RMS 最低），盡量落在
    換氣或字間停頓，不切斷字。音樂 fallback 與 VAD 安全網共用。
    """
    max_len = int(CHUNK_SECONDS * SAMPLE_RATE)
    frame = SAMPLE_RATE // 10
    n = int(QUIET_SEARCH * SAMPLE_RATE) // frame
    out: list[tuple[int, int]] = []
    while end - start > max_len:
        lo = start + max_len - n * frame
        energy = np.square(audio[lo:lo + n * frame].reshape(n, frame)).mean(axis=1)
        cut = lo + int(np.argmin(energy)) * frame + frame // 2
        out.append((start, cut))
        start = cut
    out.append((start, end))
    return out


def _speech_chunks(audio: np.ndarray) -> list[tuple[int, int]]:
    """回傳語音塊 (start_sample, end_sample) 列表；全靜音回傳空列表。

    只在語音段之間的空隙切塊：silero 以 max_speech_duration_s 把過長的連續語音
    在段內最長的停頓處拆開，保證單段（含 padding）不超過一塊的長度。
    """
    model, get_speech_timestamps = _get_vad()
    ts = get_speech_timestamps(
        to_tensor(audio), model, sampling_rate=SAMPLE_RATE,
        max_speech_duration_s=CHUNK_SECONDS - 2 * PAD - 1,
    )
    if not ts:
        return []

    pad = int(PAD * SAMPLE_RATE)
    max_gap = int(MAX_GAP * SAMPLE_RATE)
    max_len = int(CHUNK_SECONDS * SAMPLE_RATE)
    chunks: list[list[int]] = []
    for t in ts:
        s, e = max(0, t["start"] - pad), min(len(audio), t["end"] + pad)
        if chunks and s - chunks[-1][1] <= max_gap and e - chunks[-1][0] <= max_len:
            chunks[-1][1] = e  # 塊內小空隙保留原音訊，時間軸連續
            continue
        if chunks and s < chunks[-1][1]:
            # 兩段的 padding 重疊：在空隙中點分界，避免同一段音訊被兩塊各轉錄一次
            s = chunks[-1][1] = (s + chunks[-1][1]) // 2
        chunks.append([s, e])

    # 安全網：理論上不會超長，萬一有也在最安靜處切
    return [c for s, e in chunks for c in _quiet_cut(audio, s, e)]


def _is_credit(text: str) -> bool:
    return bool(_CREDIT_RE.search(text))


def _drop_repeats(segments: list[dict]) -> list[dict]:
    """連續 REPEAT_RUN 句以上完全相同（Whisper 重複迴圈）只留第一句。"""
    out: list[dict] = []
    for text, run in groupby(segments, key=lambda s: s["text"]):
        run = list(run)
        loop = len(run) >= REPEAT_RUN and len(text) >= REPEAT_MIN_CHARS
        out.extend(run[:1] if loop else run)
    return out


def _to_traditional(segments: list[dict]) -> None:
    """簡體→台灣繁體（s2twp 含用語轉換）；逐字時間戳用 s2t 保持字數對齊。"""
    from opencc import OpenCC
    s2twp, s2t = OpenCC("s2twp"), OpenCC("s2t")
    for seg in segments:
        seg["text"] = s2twp.convert(seg["text"])
        for w in seg.get("words", []):
            w["word"] = s2t.convert(w["word"])


def transcribe(
    audio: np.ndarray,
    model_path: Path,
    language: Optional[str],
    on_progress: Callable[[float], None] = lambda f: None,
) -> dict:
    """主轉錄函式。回傳 {"language", "segments": [{start,end,text,words}], "duration"}。

    audio: 16kHz 單聲道 float32 波形（audio.load_audio）
    model_path: 本機模型目錄（models.ensure 回傳）；給路徑而非 repo 名，mlx_whisper 載入時才不會連網
    language: None=自動偵測（第一塊偵測後鎖定）；"zh"/"en"/... 指定語言
    on_progress: 每完成一塊回報 0.0–1.0（以語音秒數計，真實進度）
    """
    # 延遲 import：閒置時不佔 ~130MB（numba/scipy/mlx）
    import mlx.core as mx
    import mlx_whisper
    from mlx_whisper.transcribe import ModelHolder

    model = str(model_path)
    total = len(audio) / SAMPLE_RATE
    if len(audio) == 0:
        return {"language": language or "unknown", "segments": [], "duration": total}

    mx.set_cache_limit(MLX_CACHE_LIMIT_MB << 20)
    if ModelHolder.model_path not in (None, model):
        # ModelHolder 是先載新模型再丟舊的；先清掉，避免換模型時兩個模型同時常駐
        ModelHolder.model = ModelHolder.model_path = None
        gc.collect()
        mx.clear_cache()

    chunks = _speech_chunks(audio)

    # 歌唱/音樂 fallback：silero-vad 是「語音」偵測器，對有伴奏的歌聲判定極差
    # （實測歌曲 MV 覆蓋率僅 1.4%）。覆蓋率過低時視為音樂內容，跳過 VAD
    # 直接分塊轉錄整段——這類內容幾乎沒有長靜音，幻覺風險低。
    coverage = sum(e - s for s, e in chunks) / len(audio)
    music = coverage < 0.2
    if music:
        chunks = _quiet_cut(audio, 0, len(audio))

    if not chunks:
        return {"language": language or "unknown", "segments": [], "duration": total}

    speech_total = sum(e - s for s, e in chunks) / SAMPLE_RATE
    done_sec = 0.0
    detected = language  # auto 模式：第一塊偵測後固定，避免逐塊漂移
    segments: list[dict] = []

    for s, e in chunks:
        offset = s / SAMPLE_RATE
        result = mlx_whisper.transcribe(
            audio[s:e],
            path_or_hf_repo=model,
            language=detected,
            word_timestamps=True,
            verbose=None,
        )
        if detected is None:
            detected = result.get("language")
        for seg in result["segments"]:
            text = seg["text"].strip()
            if not text or _is_credit(text):
                continue
            segments.append({
                "start": round(seg["start"] + offset, 2),
                "end": round(seg["end"] + offset, 2),
                "text": text,
                "words": [
                    {"word": w["word"], "start": round(w["start"] + offset, 2),
                     "end": round(w["end"] + offset, 2)}
                    for w in seg.get("words", [])
                ],
            })
        done_sec += (e - s) / SAMPLE_RATE
        on_progress(min(done_sec / speech_total, 1.0))

    if not music:  # 歌曲副歌本來就會連續重複
        segments = _drop_repeats(segments)
    if (detected or "").startswith("zh"):
        _to_traditional(segments)

    return {"language": detected or "unknown", "segments": segments, "duration": total}
