"""AI 去噪＋語音增強：DeepFilterNet（規格 §1/§3）。

DeepFilterNet 的 Python 套件已停止維護（相依舊版 torch/numpy），
因此改用官方 GitHub releases 的 Rust 獨立執行檔 backend/bin/deep-filter，
效果與原規格相同且零 Python 相依。輸入輸出皆為 48kHz wav。
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from ..config import BACKEND_DIR

DEEP_FILTER = BACKEND_DIR / "bin" / "deep-filter"


def denoise(media_path: Path, dest_wav: Path) -> Path:
    """任意媒體 → 增強後 wav（給後續轉錄使用）。"""
    if not DEEP_FILTER.exists():
        raise RuntimeError(
            "找不到降噪引擎 backend/bin/deep-filter：請從 "
            "https://github.com/Rikorose/DeepFilterNet/releases 下載 "
            "deep-filter-*-aarch64-apple-darwin 並放到該路徑"
        )
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "input.wav"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "quiet", "-y", "-i", str(media_path),
             "-ac", "1", "-ar", "48000", str(raw)],
            check=True,
        )
        out_dir = Path(tmp) / "out"
        out_dir.mkdir()
        proc = subprocess.run(
            [str(DEEP_FILTER), str(raw), "-o", str(out_dir)],
            capture_output=True, text=True, timeout=3600,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"降噪失敗：{proc.stderr[-300:]}")
        enhanced = out_dir / raw.name
        if not enhanced.exists():
            raise RuntimeError("降噪完成但找不到輸出檔")
        enhanced.replace(dest_wav)
    return dest_wav
