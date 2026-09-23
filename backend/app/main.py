"""FastAPI 應用程式入口。

組裝四個 router（media / folders / jobs / models）並掛上 CORS。
由 manage.sh 依根目錄 .env 的 BACKEND_PORT 啟動 uvicorn。
只綁 127.0.0.1——單人本地工具，不對外開放。
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, storage
from .routers import folders, jobs, media, models

# 啟動時確保 data/library 與 data/inbox 存在（檔案系統即資料庫，見 storage.py）
config.ensure_dirs()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 前一個 process 被停掉時還在跑的任務不會續跑：標為中斷，否則會永遠顯示進行中。
    # 放在 lifespan 而非 import 時：單純 import 驗證（後端執行中也常跑）不能動到任務檔
    n = storage.recover_interrupted_jobs()
    if n:
        logging.getLogger("uvicorn.error").info("已將 %d 個中斷的任務標為錯誤", n)
    yield


class _SkipPolling(logging.Filter):
    """前端輪詢的 access log 不記：否則每幾秒一行，淹沒真正有用的紀錄。"""

    _PATHS = ("/api/jobs?active=true", '"GET /api/models ')

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(p in msg for p in self._PATHS)


logging.getLogger("uvicorn.access").addFilter(_SkipPolling())

app = FastAPI(title="本地語音轉錄工具", version="1.0.0", lifespan=lifespan)

# 允許自訂 Port 的前端直接呼叫 API；正常請求仍由 Vite proxy 轉送。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{config.FRONTEND_PORT}",
        f"http://127.0.0.1:{config.FRONTEND_PORT}",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media.router)    # 媒體：上傳、YouTube 下載、播放串流、改名、搬移、刪除
app.include_router(folders.router)  # 資料夾：列表、建立、改名、刪除
app.include_router(jobs.router)     # 任務：建立轉錄、查進度、終止、取結果、匯出
app.include_router(models.router)   # 模型：Whisper 模型清單、預先下載、取消、刪除


@app.get("/api/health")
def health():
    """健康檢查：前端與 manage.sh 用來確認後端已就緒。"""
    return {"ok": True}
