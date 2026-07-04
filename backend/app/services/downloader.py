"""yt-dlp 下載（規格 §1/§5）：背景 job + progress hook 真實進度。"""
from __future__ import annotations

import time
from pathlib import Path

from .. import storage
from .pipeline import JobCancelled


def download(job_id: str, media_dir: Path, url: str, fmt: str) -> None:
    """在 BackgroundTasks threadpool 中執行。fmt: mp4 | mp3。

    mp4 走「最高畫質視訊 + 最佳音訊」合併（可拿到 4K/AV1）；
    mp3 下載最佳音訊後由 ffmpeg 轉 192kbps。
    進度上限刻意停在 90/92%，保留尾段給合併/轉檔，完成才跳 100。
    """
    import yt_dlp

    last_write = 0.0

    def hook(d: dict) -> None:
        """yt-dlp 進度回呼：節流寫回 job JSON，同時檢查取消旗標。"""
        nonlocal last_write
        if d["status"] == "downloading":
            now = time.monotonic()
            if now - last_write < 0.5:  # 節流：hook 觸發頻繁，避免狂寫 JSON
                return
            last_write = now
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            pct = round(d["downloaded_bytes"] / total * 90) if total else 0
            job = storage.update_job(job_id, status="processing", stage="download",
                                     progress=pct, speed=d.get("_speed_str", ""))
            if job.get("cancel_requested"):
                raise JobCancelled
        elif d["status"] == "finished":
            job = storage.update_job(job_id, progress=92, stage="download", speed=None)
            if job.get("cancel_requested"):
                raise JobCancelled

    opts = {
        "outtmpl": str(media_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
    }
    if fmt == "mp3":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }]
    else:
        opts["format"] = "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b"
        opts["merge_output_format"] = "mp4"

    try:
        job = storage.update_job(job_id, status="processing", stage="download")
        if job.get("cancel_requested"):
            raise JobCancelled
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        src = storage.source_file(media_dir)
        if src is None:
            raise RuntimeError("下載完成但找不到輸出檔")
        title = info.get("title") or url
        storage.update_meta(
            media_dir,
            title=title,
            original_filename=f"{title}.{src.suffix.lstrip('.')}",
            ext=src.suffix.lower(),
            duration_seconds=storage.probe_duration(src),
        )
        storage.update_job(job_id, status="done", progress=100, stage=None)
    except FileNotFoundError:
        pass  # 媒體在下載途中被使用者刪除，靜靜結束
    except Exception as e:  # noqa: BLE001 — 任何失敗都要寫回 job 讓前端看得到
        # hook 拋出的 JobCancelled 會被 yt-dlp 包成 DownloadError，統一以旗標判斷
        try:
            cancelled = isinstance(e, JobCancelled) or \
                (storage.get_job(job_id) or {}).get("cancel_requested")
            if cancelled:
                # 未完成的下載條目沒有保留價值，整個 media entry（含 .part 殘檔）移除
                storage.delete_media(media_dir)
                return
            storage.update_job(job_id, status="error", stage=None,
                               error_message=_readable_error(e))
        except FileNotFoundError:
            pass


def _readable_error(e: Exception) -> str:
    msg = str(e)
    if "Video unavailable" in msg:
        return "影片不存在或已被移除"
    if "Private video" in msg:
        return "這是私人影片，無法下載"
    if "Sign in" in msg:
        return "影片需要登入才能觀看（年齡限制或會員限定）"
    return f"下載失敗：{msg[:300]}"
