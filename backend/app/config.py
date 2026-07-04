"""路徑與環境設定。

單人本地工具，所有可調參數集中在此，不做設定檔系統。
此模組是全 app 最先被 import 的模組，環境變數（HF_HOME、HF_TOKEN）
必須在任何 huggingface 相關套件載入前設定完成。
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# backend/app/config.py -> 專案根目錄
PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = PROJECT_ROOT / "backend"
DATA_DIR = PROJECT_ROOT / "data"
LIBRARY_DIR = DATA_DIR / "library"
INBOX_DIR = DATA_DIR / "inbox"

# 模型統一放在專案內 models/hub/（不用 ~/.cache/huggingface），下載後永久保存。
# mlx-whisper 與 pyannote 都經由 huggingface_hub 下載，HF_HOME 一設就全部生效。
MODELS_DIR = PROJECT_ROOT / "models"
os.environ.setdefault("HF_HOME", str(MODELS_DIR))

# HF_TOKEN（pyannote gated model 用）放在 backend/.env，不進版控
load_dotenv(BACKEND_DIR / ".env")

# 轉錄模式 -> MLX 模型（規格 §3.2）
# 注意：small 與 large-v3 在 HF 上的實際 repo 名稱帶 -mlx 後綴，turbo 沒有
MODE_MODELS = {
    "cheetah": "mlx-community/whisper-small-mlx",       # 獵豹：最快，快速預覽
    "dolphin": "mlx-community/whisper-large-v3-turbo",  # 海豚：平衡，日常推薦
    "whale": "mlx-community/whisper-large-v3-mlx",      # 鯨魚：最準，重要內容
}

# 允許上傳的副檔名（其餘一律 400 拒絕）
ALLOWED_UPLOAD_EXTS = {
    ".mp3", ".mp4", ".m4a", ".mov", ".aac", ".wav",
    ".ogg", ".opus", ".mpeg", ".wma", ".wmv",
}

# 屬於影片容器的副檔名 → 前端用 <video> 播放，其餘用 <audio>
VIDEO_EXTS = {".mp4", ".mov", ".mpeg", ".wmv"}


def ensure_dirs() -> None:
    """建立 data/ 目錄骨架（app 啟動時呼叫，冪等）。"""
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
