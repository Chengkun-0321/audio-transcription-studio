"""音訊載入：任何容器（mp4/mov/mp3...）→ 16kHz 單聲道 float32。

用 ffmpeg pipe 而非 soundfile，因為 soundfile 不支援影片容器。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


def load_audio(path: Path, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """任意媒體檔 → float32 波形陣列（值域 -1.0~1.0），Whisper/VAD 的輸入格式。"""
    cmd = [
        "ffmpeg", "-nostdin", "-v", "quiet",
        "-i", str(path),
        "-f", "s16le", "-ac", "1", "-ar", str(sample_rate), "-",
    ]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, np.int16).astype(np.float32) / 32768.0


def to_wav(path: Path, dest: Path, sample_rate: int = SAMPLE_RATE) -> Path:
    """轉出 16k mono wav（pyannote / DeepFilterNet 用）。"""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "quiet", "-y", "-i", str(path),
         "-ac", "1", "-ar", str(sample_rate), str(dest)],
        check=True,
    )
    return dest
