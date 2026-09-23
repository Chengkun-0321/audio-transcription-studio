"""說話者識別（規格 §3.3）：pyannote.audio，優先用 MPS（Apple GPU），失敗退回 CPU。

舊版 pyannote 在 MPS 上有不相容運算，因此曾強制 CPU；實測 pyannote 4.0.7 + torch 2.12
在 MPS 上的結果與 CPU 逐段相同、快約 13 倍。仍保留退回 CPU 重跑的路徑以防萬一。

pipeline 以 Diarization 在 spawn 子行程執行 diarize()，與 Whisper 同時跑；子行程結束時
torch / pyannote / MPS 的記憶體全數歸還系統（MPS 的圖與 kernel 快取在行程內釋放不掉，
約 1.6GB）。Whisper 完成後再以 assign_speakers() 逐字對齊。
"""
from __future__ import annotations

import bisect
import multiprocessing as mp
import os
import sys
from itertools import accumulate
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from .audio import SAMPLE_RATE, load_audio, to_tensor

_pipeline = None
_device = "cpu"

# pyannote.audio 4.x 的最新 pipeline（gated：需在 HF 網站接受條款）
MODEL = "pyannote/speaker-diarization-community-1"

MIN_SPLIT = 0.5   # 句中換人需連續這麼多秒才切句，較短的視為對齊抖動
NEAREST = 1.0     # 字詞沒落在任何說話時段內時，找這麼多秒內最近的說話者
# embedding 批次：預設 32 在 MPS 上峰值多約 2.6GB，8 只慢約一成（實測 6 分鐘片段 6.1GB → 3.5GB）
EMBEDDING_BATCH = 8

Turn = tuple[float, float, str]


def _get_pipeline():
    global _pipeline, _device
    if _pipeline is None:
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError(
                "說話者識別需要 Hugging Face token：請在專案根目錄 .env 設定 HF_TOKEN"
            )
        import torch
        from pyannote.audio import Pipeline

        try:
            pipe = Pipeline.from_pretrained(MODEL, token=token)
        except Exception as e:
            if "403" in str(e) or "gated" in str(e).lower() or "restricted" in str(e).lower():
                raise RuntimeError(
                    "說話者識別模型尚未授權：請用你的 Hugging Face 帳號到 "
                    f"https://huggingface.co/{MODEL} 點「Agree and access repository」"
                    "接受使用條款後重試（免費，只需做一次）"
                ) from e
            raise
        pipe.embedding_batch_size = EMBEDDING_BATCH
        _device = "mps" if torch.backends.mps.is_available() else "cpu"
        _pipeline = pipe.to(torch.device(_device))
    return _pipeline


def _fallback_to_cpu():
    """MPS 執行失敗（不支援的運算、記憶體不足）時改用 CPU 重跑。"""
    global _device
    import torch
    _device = "cpu"
    torch.mps.empty_cache()
    return _get_pipeline().to(torch.device("cpu"))


def diarize(audio: np.ndarray, num_speakers: Optional[int] = None,
            on_progress: Callable[[float], None] = lambda f: None) -> list[Turn]:
    """16kHz 單聲道波形 → 說話時段 [(start, end, "S1"), ...]，依開始時間排序。

    直接吃記憶體內波形，不另外寫暫存 wav。
    取 exclusive_speaker_diarization：pyannote 4 專為對齊轉錄設計，同一時間只有一人。
    說話者改名為 S1/S2...（照首次出現順序），比 SPEAKER_00 好讀。
    """
    pipe = _get_pipeline()
    # pyannote 支援 hook 回報各步驟批次進度；兩個重運算步驟依經驗各佔約一半時間
    spans = {"segmentation": (0.0, 0.5), "embeddings": (0.5, 0.95)}

    def hook(step_name, _artifact, file=None, total=None, completed=None):  # noqa: ARG001
        span = spans.get(step_name)
        if span and total:
            lo, hi = span
            on_progress(lo + (hi - lo) * (completed or 0) / total)

    def run(p):
        on_progress(0.0)  # 使用者已要求停止時在此拋出，不會為了退回 CPU 而重跑
        return p({"waveform": to_tensor(audio)[None], "sample_rate": SAMPLE_RATE},
                 num_speakers=num_speakers, hook=hook)

    try:
        result = run(pipe)
    except Exception as e:
        if _device != "mps":
            raise
        print(f"[diarizer] MPS 執行失敗，改用 CPU 重跑：{e!r}", file=sys.stderr)
        result = run(_fallback_to_cpu())
    annotation = getattr(result, "exclusive_speaker_diarization", result)
    turns = sorted((t.start, t.end, spk) for t, _, spk in annotation.itertracks(yield_label=True))

    order: dict[str, str] = {}
    for _, _, spk in turns:
        order.setdefault(spk, f"S{len(order) + 1}")
    on_progress(1.0)
    return [(s, e, order[spk]) for s, e, spk in turns]


def _child(src: str, num_speakers: Optional[int], progress, conn) -> None:
    """子行程進入點：解碼原始音訊 → diarize → 經 pipe 回傳 ("ok", turns) 或 ("error", 訊息)。"""
    try:
        audio = load_audio(Path(src))
        conn.send(("ok", diarize(audio, num_speakers,
                                 on_progress=lambda f: setattr(progress, "value", f))))
    except BaseException as e:  # noqa: BLE001 — 任何失敗都要回報給父行程
        conn.send(("error", str(e) or type(e).__name__))
    finally:
        conn.close()


class Diarization:
    """在 spawn 子行程跑說話者識別，父行程只輪詢進度與結果。

    - 記憶體：任務結束子行程退出，torch/pyannote/MPS 佔用全數歸還（閒置後端不殘留）
    - 取消：直接 terminate，不必等 pyannote 的下個進度點
    - 另一個原因：pyannote 相依的 optuna 會把選用套件的 ImportError 連同 traceback 永久存在
      模組裡，經 frame 的 f_back 釘住 import 當下整條呼叫鏈的區域變數（實測第一個任務的
      音訊與 pipeline 永遠無法回收）；在子行程 import 就無所謂
    """

    def __init__(self, src: Path, num_speakers: Optional[int] = None):
        ctx = mp.get_context("spawn")
        self._progress = ctx.Value("d", 0.0, lock=False)
        self._recv, send = ctx.Pipe(duplex=False)
        self._proc = ctx.Process(target=_child, args=(str(src), num_speakers, self._progress, send),
                                 name="diarize", daemon=True)
        self._proc.start()
        send.close()  # 父行程只收；子行程結束後 recv 才會收到 EOF
        self._result: Optional[tuple] = None

    @property
    def progress(self) -> float:
        return self._progress.value

    def done(self) -> bool:
        return self._result is not None or self._recv.poll() or not self._proc.is_alive()

    def wait(self, timeout: float) -> None:
        self._recv.poll(timeout)

    def result(self) -> list[Turn]:
        """取結果（會阻塞到子行程回報）；子行程失敗時拋出其錯誤訊息。"""
        if self._result is None:
            try:
                self._result = self._recv.recv()
            except EOFError:
                self._result = ("error", f"說話者識別行程異常結束（exit code {self._proc.exitcode}）")
            self._proc.join()
        kind, value = self._result
        if kind == "error":
            raise RuntimeError(value)
        return value

    def close(self) -> None:
        """結束子行程（取消或失敗時直接終止）並回收資源。"""
        if self._proc.is_alive():
            self._proc.terminate()
        self._proc.join()
        self._recv.close()


class _Lookup:
    """依時間查說話者。turns 依開始時間排序；以 bisect 只看附近的時段。"""

    def __init__(self, turns: list[Turn]):
        self.turns = turns
        self.starts = [t[0] for t in turns]
        # 結束時間的前綴最大值（單調遞增），時段即使重疊也能安全二分
        self.max_ends = list(accumulate((t[1] for t in turns), max))

    def speaker(self, start: float, end: float) -> Optional[str]:
        """時間重疊最長的說話者；都沒重疊時取 NEAREST 秒內最近者（重疊量為負的距離）。"""
        lo = bisect.bisect_left(self.max_ends, start - NEAREST)
        hi = bisect.bisect_right(self.starts, end + NEAREST)
        best, best_ov = None, -NEAREST
        for ts, te, spk in self.turns[lo:hi]:
            ov = min(end, te) - max(start, ts)
            if ov > best_ov:
                best, best_ov = spk, ov
        return best


def _runs(words: list[dict], labels: list[str]) -> list[list]:
    """連續同說話者的字詞併成 [speaker, i, j)；短於 MIN_SPLIT 秒的段併入前一段（句首併入後一段）。"""
    runs: list[list] = []
    for i, lab in enumerate(labels):
        if runs and runs[-1][0] == lab:
            runs[-1][2] = i + 1
        else:
            runs.append([lab, i, i + 1])

    def dur(r: list) -> float:
        return words[r[2] - 1]["end"] - words[r[1]]["start"]

    merged: list[list] = []
    for r in runs:
        if merged and (dur(r) < MIN_SPLIT or merged[-1][0] == r[0]):
            merged[-1][2] = r[2]
        else:
            merged.append(r)
    if len(merged) > 1 and dur(merged[0]) < MIN_SPLIT:
        merged[1][1] = merged[0][1]
        merged.pop(0)
    return merged


def assign_speakers(segments: list[dict], turns: list[Turn],
                    language: Optional[str]) -> list[dict]:
    """逐字指派說話者，句中換人時切句；回傳新的 segments 列表。

    沒有逐字時間戳的句子退回整句指派。切開的句子文字由字詞重組，中文再過一次
    s2twp（字詞已是 s2t 繁體，s2twp 補上台灣用語）；沒切開的句子保留原文字。
    """
    lookup = _Lookup(turns)
    s2twp = None
    if (language or "").startswith("zh"):
        from opencc import OpenCC
        s2twp = OpenCC("s2twp")

    out: list[dict] = []
    for seg in segments:
        words = seg.get("words") or []
        labels = [lookup.speaker(w["start"], w["end"]) for w in words]
        known = [lab for lab in labels if lab is not None]
        if not known:
            spk = lookup.speaker(seg["start"], seg["end"])
            if spk is not None:
                seg["speaker"] = spk
            out.append(seg)
            continue

        # 判定不了的字沿用前一個字的說話者（句首的沿用第一個判定到的）
        prev = known[0]
        for i, lab in enumerate(labels):
            labels[i] = prev = lab or prev

        runs = _runs(words, labels)
        if len(runs) == 1:
            seg["speaker"] = runs[0][0]
            out.append(seg)
            continue
        for k, (spk, i, j) in enumerate(runs):
            ws = words[i:j]
            text = "".join(w["word"] for w in ws).strip()
            out.append({
                "start": seg["start"] if k == 0 else ws[0]["start"],
                "end": seg["end"] if k == len(runs) - 1 else ws[-1]["end"],
                "text": s2twp.convert(text) if s2twp else text,
                "words": ws,
                "speaker": spk,
            })
    return out
