"""任務 API：建立轉錄任務、查詢進度、終止、取結果、匯出 TXT/SRT/DOCX。"""
from __future__ import annotations

import urllib.parse

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from .. import config, storage
from ..services import exporter
from ..services.pipeline import run_transcribe_job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class JobReq(BaseModel):
    media_id: str
    mode: str = "dolphin"          # cheetah | dolphin | whale（規格 §3.2）
    language: str = "auto"         # auto | zh | en | ...
    diarization: bool = False
    denoise: bool = False


@router.post("")
def create_job(req: JobReq, background: BackgroundTasks):
    """建立轉錄任務，立即回傳 job；實際轉錄在 BackgroundTasks threadpool 執行。"""
    if req.mode not in config.MODE_MODELS:
        raise HTTPException(400, f"未知的轉錄模式: {req.mode}")
    media_dir = storage.find_media_dir(req.media_id)
    if media_dir is None:
        raise HTTPException(404, "找不到此媒體")
    if storage.source_file(media_dir) is None:
        raise HTTPException(400, "媒體檔尚未就緒（可能還在下載中）")
    job = storage.create_job(
        media_dir, "transcribe",
        mode=req.mode, language=req.language,
        diarization=req.diarization, denoise=req.denoise,
    )
    background.add_task(run_transcribe_job, job["id"], media_dir)
    return job


@router.get("")
def list_jobs(active: bool = False):
    """任務列表；active=true 只回進行中（前端 2 秒輪詢用）。"""
    return storage.list_jobs(active_only=active)


@router.get("/{job_id}")
def get_job(job_id: str):
    """單一任務狀態。"""
    job = storage.get_job(job_id)
    if job is None:
        raise HTTPException(404, "找不到此任務")
    return job


@router.post("/{job_id}/cancel")
def cancel_job(job_id: str):
    """終止任務：設下 cancel_requested 旗標，worker 在下個進度回報點停止。

    轉錄任務標為 cancelled 留在歷史；下載任務會連媒體條目一併移除。
    """
    try:
        return storage.request_cancel(job_id)
    except FileNotFoundError:
        raise HTTPException(404, "找不到此任務")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{job_id}/segments")
def get_segments(job_id: str):
    """轉錄結果原始 JSON（segments + words + speaker），前端逐字稿頁用。"""
    path = storage.segments_path(job_id)
    if path is None or not path.exists():
        raise HTTPException(404, "尚無轉錄結果")
    return storage.read_json(path)


@router.get("/{job_id}/transcript")
def transcript(job_id: str, format: str = "txt", timestamps: bool = True):
    """匯出逐字稿（txt/srt/docx），由 segments.json 即時產生。

    timestamps=false 時 TXT/DOCX 不含時間戳、文字接在一起
    （有說話者仍按輪替分段）；SRT 格式本質需要時間軸，不受影響。
    檔名用 RFC 5987 編碼以支援中文標題。
    """
    job = storage.get_job(job_id)
    path = storage.segments_path(job_id)
    if job is None or path is None or not path.exists():
        raise HTTPException(404, "尚無轉錄結果")
    data_json = storage.read_json(path)
    segments = data_json["segments"]
    language = data_json.get("language") or job.get("detected_language")

    media_dir = storage.find_media_dir(job["media_id"])
    meta = storage.read_json(media_dir / "meta.json") if media_dir else {}
    title = meta.get("title") or job["media_id"]
    filename = urllib.parse.quote(f"{title}.{format}")
    disposition = f"attachment; filename*=UTF-8''{filename}"

    if format == "txt":
        return PlainTextResponse(
            exporter.to_txt(segments, timestamps=timestamps, language=language),
            headers={"Content-Disposition": disposition})
    if format == "srt":
        return PlainTextResponse(exporter.to_srt(segments), media_type="text/plain",
                                 headers={"Content-Disposition": disposition})
    if format == "docx":
        data = exporter.to_docx(segments, title, {
            "duration_seconds": meta.get("duration_seconds"),
            "language": job.get("detected_language") or job.get("language"),
            "mode": job.get("mode"),
            "created_at": job.get("created_at"),
        }, timestamps=timestamps, language=language)
        return Response(
            data,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": disposition},
        )
    raise HTTPException(400, "format 必須是 txt / srt / docx")
