"""說話者識別（規格 §3.3）：pyannote.audio，強制 CPU。

pyannote pipeline 在 MPS 上部分運算不相容，實務會退回 CPU（已知限制），
因此直接指定 CPU，不嘗試 MPS。模型延遲載入：不開啟 diarization 就不佔記憶體。
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Callable

from .audio import to_wav

_pipeline = None

# pyannote.audio 4.x 的最新 pipeline（gated：需在 HF 網站接受條款）
MODEL = "pyannote/speaker-diarization-community-1"


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError(
                "說話者識別需要 Hugging Face token：請在 backend/.env 設定 HF_TOKEN"
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
        _pipeline = pipe.to(torch.device("cpu"))
    return _pipeline


def assign_speakers(media_path: Path, segments: list[dict],
                    on_progress: Callable[[float], None] = lambda f: None) -> None:
    """就地為每個 segment 加上 speaker 欄位（依時間重疊最大者）。"""
    pipe = _get_pipeline()
    # pyannote 支援 hook 回報各步驟批次進度；兩個重運算步驟依經驗各佔約一半時間
    spans = {"segmentation": (0.05, 0.5), "embeddings": (0.5, 0.9)}

    def hook(step_name, _artifact, file=None, total=None, completed=None):  # noqa: ARG001
        span = spans.get(step_name)
        if span and total:
            lo, hi = span
            on_progress(lo + (hi - lo) * (completed or 0) / total)

    with tempfile.TemporaryDirectory() as tmp:
        wav = to_wav(media_path, Path(tmp) / "audio.wav")
        on_progress(0.05)
        result = pipe(str(wav), hook=hook)
    # pyannote 4.x 回傳 DiarizeOutput，Annotation 在 .speaker_diarization；3.x 直接回傳 Annotation
    annotation = getattr(result, "speaker_diarization", result)
    on_progress(0.9)

    turns = [(t.start, t.end, spk) for t, _, spk in annotation.itertracks(yield_label=True)]
    # 說話者改名為 S1/S2...（照首次出現順序），比 SPEAKER_00 好讀
    order: dict[str, str] = {}
    for _, _, spk in sorted(turns):
        order.setdefault(spk, f"S{len(order) + 1}")

    for seg in segments:
        best, best_ov = None, 0.0
        for ts, te, spk in turns:
            ov = min(seg["end"], te) - max(seg["start"], ts)
            if ov > best_ov:
                best, best_ov = spk, ov
        if best is not None:
            seg["speaker"] = order[best]
    on_progress(1.0)
