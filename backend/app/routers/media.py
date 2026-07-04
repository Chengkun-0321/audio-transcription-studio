"""媒體 API：上傳、YouTube 下載、列表、播放串流、改名、搬移、刪除。"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import config, storage
from ..services import downloader

router = APIRouter(prefix="/api/media", tags=["media"])


def _media_dir_or_404(media_id: str) -> Path:
    """依 ID 取媒體目錄，不存在直接回 404。"""
    d = storage.find_media_dir(media_id)
    if d is None:
        raise HTTPException(404, "找不到此媒體")
    return d


@router.post("/upload")
async def upload(file: UploadFile, folder: Optional[str] = Form(None)):
    """上傳媒體檔（multipart）。以 1MB 分塊寫入避免大檔佔記憶體。"""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in config.ALLOWED_UPLOAD_EXTS:
        raise HTTPException(400, f"不支援的格式 {ext or '(無副檔名)'}")
    try:
        media_dir = storage.create_media_entry(
            folder=folder,
            title=Path(file.filename).stem,
            original_filename=file.filename,
            source_type="upload",
            ext=ext,
        )
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))

    dest = media_dir / f"source{ext}"
    with dest.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    meta = storage.update_meta(media_dir, duration_seconds=storage.probe_duration(dest))
    return storage.media_summary(media_dir)


class YoutubeReq(BaseModel):
    url: str
    folder: Optional[str] = None
    format: str = "mp4"  # mp4 | mp3


@router.post("/youtube")
def youtube(req: YoutubeReq, background: BackgroundTasks):
    """建立 YouTube 下載任務：先建媒體條目，實際下載交給背景 job。"""
    if req.format not in ("mp4", "mp3"):
        raise HTTPException(400, "format 必須是 mp4 或 mp3")
    if not req.url.strip().startswith(("http://", "https://")):
        raise HTTPException(400, "請貼上有效的網址")
    try:
        media_dir = storage.create_media_entry(
            folder=req.folder,
            title=req.url.strip(),  # 下載完成後以影片標題覆蓋
            original_filename="",
            source_type="youtube",
            source_url=req.url.strip(),
        )
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))
    job = storage.create_job(media_dir, "download", url=req.url.strip(), format=req.format)
    background.add_task(downloader.download, job["id"], media_dir, req.url.strip(), req.format)
    return {"media": storage.media_summary(media_dir), "job": job}


@router.get("")
def list_media(folder: Optional[str] = None):
    """媒體列表。folder 省略=全部、"inbox"=未分類、其他=指定資料夾。"""
    return storage.list_media(folder)


@router.get("/{media_id}")
def get_media(media_id: str):
    """單一媒體完整資訊（meta + 任務列表）。"""
    return storage.media_summary(_media_dir_or_404(media_id))


@router.get("/{media_id}/file")
def media_file(media_id: str):
    """原始媒體檔串流：站內 <video>/<audio> 播放的來源。"""
    src = storage.source_file(_media_dir_or_404(media_id))
    if src is None:
        raise HTTPException(404, "媒體檔尚未就緒")
    # Starlette FileResponse 原生支援 HTTP Range，<video>/<audio> 可拖曳 seek
    media_types = {".mp4": "video/mp4", ".mov": "video/quicktime",
                   ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
                   ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/opus"}
    return FileResponse(src, media_type=media_types.get(src.suffix.lower(),
                                                        "application/octet-stream"))


class RenameReq(BaseModel):
    title: str


@router.patch("/{media_id}")
def rename(media_id: str, req: RenameReq):
    """媒體改名（只改 meta 的 title，不動實體檔名）。"""
    if not req.title.strip():
        raise HTTPException(400, "名稱不可為空")
    d = _media_dir_or_404(media_id)
    storage.update_meta(d, title=req.title.strip())
    return storage.media_summary(d)


class MoveReq(BaseModel):
    folder: Optional[str] = None  # None/"inbox" = 移回未分類


@router.patch("/{media_id}/move")
def move(media_id: str, req: MoveReq):
    """搬移媒體到指定資料夾（folder=null 移回未分類）。"""
    d = _media_dir_or_404(media_id)
    try:
        new_dir = storage.move_media(d, req.folder)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))
    return storage.media_summary(new_dir)


@router.delete("/{media_id}")
def delete(media_id: str):
    """刪除媒體（原始檔 + 所有轉錄結果一併刪除，無法復原）。"""
    storage.delete_media(_media_dir_or_404(media_id))
    return {"ok": True}
