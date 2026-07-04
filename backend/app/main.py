"""FastAPI 應用程式入口。

組裝三個 router（media / folders / jobs）並掛上 CORS。
由 manage.sh 以 uvicorn 啟動：`uvicorn app.main:app --host 127.0.0.1 --port 8000`。
只綁 127.0.0.1——單人本地工具，不對外開放。
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .routers import folders, jobs, media

# 啟動時確保 data/library 與 data/inbox 存在（檔案系統即資料庫，見 storage.py）
config.ensure_dirs()

app = FastAPI(title="本地語音轉錄工具", version="1.0.0")

# 前端 dev server 在 3000（Vite proxy 也會轉 /api，此處為雙保險）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media.router)    # 媒體：上傳、YouTube 下載、播放串流、改名、搬移、刪除
app.include_router(folders.router)  # 資料夾：列表、建立、改名、刪除
app.include_router(jobs.router)     # 任務：建立轉錄、查進度、終止、取結果、匯出


@app.get("/api/health")
def health():
    """健康檢查：前端與 manage.sh 用來確認後端已就緒。"""
    return {"ok": True}
