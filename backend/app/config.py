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

# Port 與 HF_TOKEN 統一由專案根目錄 .env 管理。
load_dotenv(PROJECT_ROOT / ".env")


def _port(name: str, default: int) -> int:
    """讀取並驗證 TCP Port，避免錯誤設定延遲到服務啟動後才失敗。"""
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} 必須是整數，目前值：{raw}") from exc
    if not 1 <= value <= 65535:
        raise RuntimeError(f"{name} 必須介於 1–65535，目前值：{value}")
    return value


BACKEND_PORT = _port("BACKEND_PORT", 8000)
FRONTEND_PORT = _port("FRONTEND_PORT", 3000)

# 模型統一放在專案內 models/hub/（不用 ~/.cache/huggingface），下載後永久保存。
# mlx-whisper 與 pyannote 都經由 huggingface_hub 下載，HF_HOME 一設就全部生效。
MODELS_DIR = PROJECT_ROOT / "models"
#os.environ.setdefault("HF_HOME", str(MODELS_DIR))
# 只有系統未設定 HF_HOME 時才使用專案 models/；若已設定，模型會存到外部路徑。
os.environ["HF_HOME"] = str(MODELS_DIR)
# 無論系統設定為何，都強制使用此專案的 models/。

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
