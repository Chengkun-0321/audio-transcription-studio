"""音訊載入：任何容器（mp4/mov/mp3...）→ 16kHz 單聲道 float32。

用 ffmpeg pipe 而非 soundfile，因為 soundfile 不支援影片容器。
"""
from __future__ import annotations

import subprocess
import warnings
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


def load_audio(path: Path, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """任意媒體檔 → float32 波形陣列（值域 -1.0~1.0），Whisper/VAD/pyannote 的輸入格式。

    ffmpeg 直接輸出 f32le，np.frombuffer 零拷貝包住 stdout：峰值每樣本 4 bytes
    （先轉 int16 再 astype、除法會各多一份，峰值 10 bytes，1 小時音檔多吃約 350MB）。
    回傳的陣列唯讀（底層是 bytes），下游只讀不寫。
    """
    cmd = [
        "ffmpeg", "-nostdin", "-v", "quiet",
        "-i", str(path),
        "-f", "f32le", "-ac", "1", "-ar", str(sample_rate), "-",
    ]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32)


def to_tensor(audio: np.ndarray):
    """波形陣列 → torch Tensor（共用記憶體不複製）。

    load_audio 的陣列唯讀，torch 會發「not writable」警告；silero/pyannote 只讀，故抑制。
    """
    import torch

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        return torch.from_numpy(audio)
