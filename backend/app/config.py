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
# 刻意覆寫（非 setdefault）：無論系統有沒有設 HF_HOME，都強制用此專案的 models/。
os.environ["HF_HOME"] = str(MODELS_DIR)
# 關掉 Xet 協定、改走一般 HTTP 下載：Xet 的進度只在檔案快完成時才回報，
# 進度 callback 丟出的例外也會被吞掉（取消不了）。HTTP 能逐塊回報進度、可中止、可續傳。
os.environ["HF_HUB_DISABLE_XET"] = "1"

# 可選的 Whisper 模型（dict 順序 = 前端顯示順序）；前端清單一律由 GET /api/models 取得。
# 注意：HF 實際 repo 名只有 large-v3-turbo 沒有 -mlx 後綴，其餘都有（寫錯會 404）。
# download_mb 是 HF 上的檔案大小，僅供顯示「首次使用會下載多少」。
WHISPER_MODELS: dict[str, dict] = {
    "tiny": {"repo": "mlx-community/whisper-tiny-mlx", "params": "39M",
             "download_mb": 74, "note": "最快，準確度最低，適合試跑"},
    "base": {"repo": "mlx-community/whisper-base-mlx", "params": "74M",
             "download_mb": 144, "note": "很快，清楚的單人語音可用"},
    "small": {"repo": "mlx-community/whisper-small-mlx", "params": "244M",
              "download_mb": 481, "note": "快，適合快速預覽"},
    "medium": {"repo": "mlx-community/whisper-medium-mlx", "params": "769M",
               "download_mb": 1525, "note": "較準，速度中等"},
    "large-v2": {"repo": "mlx-community/whisper-large-v2-mlx", "params": "1.55B",
                 "download_mb": 3083, "note": "舊版最大模型，部分內容幻覺較少"},
    "large-v3": {"repo": "mlx-community/whisper-large-v3-mlx", "params": "1.55B",
                 "download_mb": 3084, "note": "最準，最慢，重要內容用"},
    "large-v3-turbo": {"repo": "mlx-community/whisper-large-v3-turbo", "params": "809M",
                       "download_mb": 1614, "note": "接近 large-v3 的準確度、快很多，日常推薦"},
}
DEFAULT_MODEL = "large-v3-turbo"
# 舊版 job 只存轉錄模式（mode），顯示/匯出時對應回模型
LEGACY_MODES = {"cheetah": "small", "dolphin": "large-v3-turbo", "whale": "large-v3"}

# MLX 會把用過的 Metal buffer 留作快取重用，預設無上限（實測 large-v3 6 分鐘音訊 50 秒內
# 衝破 11GB）。256MB 與 1GB 實測速度無差、峰值少約 0.7GB
MLX_CACHE_LIMIT_MB = 256

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
