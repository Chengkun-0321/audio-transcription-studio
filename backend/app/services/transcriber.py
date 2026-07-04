"""MLX Whisper 轉錄：VAD 切段 + 分塊進度回報 + 繁體中文輸出。

流程（規格 §3.1/§3.2/§8）:
1. silero-vad 找出語音區間，切除長靜音 —— Whisper 靜音幻覺的主要防線
2. 語音區間合併成 <= CHUNK_SECONDS 的塊，逐塊丟給 mlx-whisper，
   每塊完成即回報進度（真實進度，非動畫）
3. 時間戳映射回原始時間軸；中文結果用 OpenCC s2twp 轉繁體
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

import mlx_whisper
import numpy as np

from ..config import MODE_MODELS
from .audio import SAMPLE_RATE, load_audio

CHUNK_SECONDS = 120.0   # 進度粒度與單次推理長度的折衷
MERGE_GAP = 1.0         # 語音段間隔小於此秒數視為連續
PAD = 0.25              # 語音段前後保留，避免 VAD 切掉字頭字尾

_vad_model = None


def _get_vad():
    """延遲載入 silero-vad 模型（隨 pip 套件安裝在 .venv 內，非 HF 下載）。"""
    global _vad_model
    if _vad_model is None:
        from silero_vad import load_silero_vad
        _vad_model = load_silero_vad()
    return _vad_model


def _speech_chunks(audio: np.ndarray) -> list[tuple[int, int]]:
    """回傳語音塊 (start_sample, end_sample) 列表；全靜音回傳空列表。"""
    import torch
    from silero_vad import get_speech_timestamps

    ts = get_speech_timestamps(torch.from_numpy(audio), _get_vad(), sampling_rate=SAMPLE_RATE)
    if not ts:
        return []

    pad = int(PAD * SAMPLE_RATE)
    gap = int(MERGE_GAP * SAMPLE_RATE)
    merged: list[list[int]] = []
    for t in ts:
        s, e = max(0, t["start"] - pad), min(len(audio), t["end"] + pad)
        if merged and s - merged[-1][1] <= gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])

    # 併成不超過 CHUNK_SECONDS 的塊（塊內小空隙保留原音訊，時間軸連續）
    max_len = int(CHUNK_SECONDS * SAMPLE_RATE)
    chunks: list[tuple[int, int]] = []
    cur_s, cur_e = merged[0]
    for s, e in merged[1:]:
        if e - cur_s <= max_len and s - cur_e <= gap * 30:  # 30s 內的間隔仍併塊
            cur_e = e
        else:
            chunks.append((cur_s, cur_e))
            cur_s, cur_e = s, e
    chunks.append((cur_s, cur_e))

    # 單塊仍可能超長（連續語音），硬切
    final: list[tuple[int, int]] = []
    for s, e in chunks:
        while e - s > max_len:
            final.append((s, s + max_len))
            s += max_len
        final.append((s, e))
    return final


def _to_traditional(segments: list[dict]) -> None:
    """簡體→台灣繁體（s2twp 含用語轉換）；逐字時間戳用 s2t 保持字數對齊。"""
    from opencc import OpenCC
    s2twp, s2t = OpenCC("s2twp"), OpenCC("s2t")
    for seg in segments:
        seg["text"] = s2twp.convert(seg["text"])
        for w in seg.get("words", []):
            w["word"] = s2t.convert(w["word"])


def transcribe(
    media_path: Path,
    mode: str,
    language: Optional[str],
    on_progress: Callable[[float], None] = lambda f: None,
) -> dict:
    """主轉錄函式。回傳 {"language", "segments": [{start,end,text,words}], "duration"}。

    mode: cheetah/dolphin/whale（config.MODE_MODELS）
    language: None=自動偵測（第一塊偵測後鎖定）；"zh"/"en"/... 指定語言
    on_progress: 每完成一塊回報 0.0–1.0（以語音秒數計，真實進度）
    """
    model = MODE_MODELS[mode]
    audio = load_audio(media_path)
    total = len(audio) / SAMPLE_RATE

    chunks = _speech_chunks(audio)

    # 歌唱/音樂 fallback：silero-vad 是「語音」偵測器，對有伴奏的歌聲判定極差
    # （實測歌曲 MV 覆蓋率僅 1.4%）。覆蓋率過低時視為音樂內容，跳過 VAD
    # 直接分塊轉錄整段——這類內容幾乎沒有長靜音，幻覺風險低。
    coverage = sum(e - s for s, e in chunks) / len(audio) if len(audio) else 0.0
    if coverage < 0.2:
        max_len = int(CHUNK_SECONDS * SAMPLE_RATE)
        chunks = [(s, min(s + max_len, len(audio))) for s in range(0, len(audio), max_len)]

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
            if not text:
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

    if (detected or "").startswith("zh"):
        _to_traditional(segments)

    return {"language": detected or "unknown", "segments": segments, "duration": total}
