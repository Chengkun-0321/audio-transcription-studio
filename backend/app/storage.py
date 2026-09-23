"""檔案系統儲存層（規格 §4）：無資料庫，media/job 皆為資料夾 + JSON。

目錄結構:
  data/inbox/<media-id>/            未歸類（預設落點）
  data/library/<folder>/<media-id>/ 已歸類
  <media-id>/source.<ext>           原始媒體
  <media-id>/meta.json              檔案層級 metadata
  <media-id>/jobs/<job-id>.json     任務狀態
  <media-id>/jobs/<job-id>.segments.json  轉錄結果（單一真實來源）

設計要點：
- 所有 JSON 寫入走 atomic_write_json（先寫 tmp 再 rename），
  前端 2 秒輪詢也不會讀到寫一半的檔案
- 搬移/刪除媒體 = 搬移/刪除資料夾本身，metadata 永遠跟著檔案走，
  備份整個 data/ 目錄即為完整備份
- job 檔就是任務狀態的唯一真實來源：worker 寫、API 讀；記憶體只放加速查找的索引
  （_JOB_PATHS、_ACTIVE_JOBS），不存狀態本身
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator, Optional

from . import config

# 單一 uvicorn process，記憶體註冊表加速 job_id -> 路徑查找；重啟後靠掃描重建
_JOB_PATHS: dict[str, Path] = {}
# 進行中（queued/processing）的 job ID：前端輪詢只讀這些，不必每次掃遍全部 job 檔。
# 重啟時由 recover_interrupted_jobs() 清掉殘留任務，所以從空集合開始即正確
_ACTIVE_JOBS: set[str] = set()
_ACTIVE_STATUSES = ("queued", "processing")
# update_job 的讀→改→寫在鎖內：否則 worker 的進度寫入可能蓋掉剛設下的 cancel_requested
_lock = threading.Lock()

_FOLDER_NAME_RE = re.compile(r"^[^/\\\0]{1,80}$")


class JobClosed(FileNotFoundError):
    """任務已是終態卻還有人要寫入：通常是重啟時被判定中斷，但舊 process 還在收尾
    （uvicorn 關閉時會等背景任務跑完）。沿用 FileNotFoundError，worker 會安靜結束。"""


def now_iso() -> str:
    """本地時區的 ISO-8601 時間字串（所有 created_at / completed_at 用）。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def atomic_write_json(path: Path, obj: Any) -> None:
    """原子寫入 JSON：先寫 tmp 再 rename，讀取端永遠看到完整檔案。"""
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> Any:
    """讀取 JSON 檔（UTF-8）。"""
    return json.loads(path.read_text(encoding="utf-8"))


def valid_folder_name(name: str) -> bool:
    """資料夾名安全檢查：擋路徑分隔符、隱藏檔、`.`/`..`，長度 1–80。"""
    return bool(_FOLDER_NAME_RE.match(name)) and name not in {".", ".."} and not name.startswith(".")


# ---------- media ----------

def new_media_id() -> str:
    """媒體 ID：時間戳 + 4 位隨機 hex（可讀又不易撞名），同時是目錄名。"""
    return time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)


def folder_dir(folder: Optional[str]) -> Path:
    """資料夾名 → 實體目錄。None/""/"inbox" 都代表未分類（inbox）。"""
    if folder in (None, "", "inbox"):
        return config.INBOX_DIR
    if not valid_folder_name(folder):
        raise ValueError(f"不合法的資料夾名稱: {folder!r}")
    return config.LIBRARY_DIR / folder


def iter_media_dirs() -> Iterator[Path]:
    """走訪所有媒體目錄（inbox + library/*/*），以 meta.json 存在為準。"""
    for base in [config.INBOX_DIR, *sorted(p for p in config.LIBRARY_DIR.iterdir() if p.is_dir())] \
            if config.LIBRARY_DIR.exists() else [config.INBOX_DIR]:
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            if d.is_dir() and (d / "meta.json").exists():
                yield d


def find_media_dir(media_id: str) -> Optional[Path]:
    """依 ID 找媒體目錄；不存在回傳 None。"""
    for d in iter_media_dirs():
        if d.name == media_id:
            return d
    return None


def folder_of(media_dir: Path) -> Optional[str]:
    """媒體目錄 → 所屬資料夾名；在 inbox 回傳 None（前端顯示「未分類」）。"""
    parent = media_dir.parent
    return None if parent == config.INBOX_DIR else parent.name


def source_file(media_dir: Path) -> Optional[Path]:
    """找出媒體來源檔 source.<ext>；跳過下載中的 .part/.tmp 半成品。"""
    for f in media_dir.glob("source.*"):
        if not f.name.endswith(".part") and not f.name.endswith(".tmp"):
            return f
    return None


def probe_duration(path: Path) -> Optional[float]:
    """用 ffprobe 取媒體時長（秒）；失敗回傳 None，不阻斷主流程。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        dur = json.loads(out.stdout).get("format", {}).get("duration")
        return round(float(dur), 1) if dur else None
    except Exception:
        return None


def create_media_entry(
    folder: Optional[str],
    title: str,
    original_filename: str,
    source_type: str,
    source_url: Optional[str] = None,
    ext: Optional[str] = None,
) -> Path:
    """建立新媒體目錄（含 jobs/ 子目錄與初始 meta.json），回傳目錄路徑。

    source_type: "upload"（本機上傳）或 "youtube"（網址下載）。
    YouTube 下載時 ext/duration 尚未知，下載完成後由 downloader 補寫。
    """
    base = folder_dir(folder)
    if folder and not base.exists():
        raise FileNotFoundError(f"資料夾不存在: {folder}")
    media_dir = base / new_media_id()
    (media_dir / "jobs").mkdir(parents=True)
    meta = {
        "id": media_dir.name,
        "title": title,
        "original_filename": original_filename,
        "source_type": source_type,
        "source_url": source_url,
        "ext": ext,
        "media_kind": ("video" if ext in config.VIDEO_EXTS else "audio") if ext else None,
        "duration_seconds": None,
        "created_at": now_iso(),
    }
    atomic_write_json(media_dir / "meta.json", meta)
    return media_dir


def update_meta(media_dir: Path, **patch: Any) -> dict:
    """部分更新 meta.json；改了 ext 會連動更新 media_kind（video/audio）。"""
    meta = read_json(media_dir / "meta.json")
    meta.update(patch)
    if patch.get("ext"):
        meta["media_kind"] = "video" if patch["ext"] in config.VIDEO_EXTS else "audio"
    atomic_write_json(media_dir / "meta.json", meta)
    return meta


def media_summary(media_dir: Path) -> dict:
    """組合前端需要的完整媒體資訊：meta + 所屬資料夾 + 任務列表（新到舊）。"""
    meta = read_json(media_dir / "meta.json")
    jobs = [read_json(p) for p in sorted((media_dir / "jobs").glob("*.json"))
            if not p.name.endswith(".segments.json")]
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return {
        **meta,
        "folder": folder_of(media_dir),
        "jobs": jobs,
        "latest_job": jobs[0] if jobs else None,
        "has_transcript": any(
            j["type"] == "transcribe" and j["status"] == "done" for j in jobs
        ),
    }


def list_media(folder: Optional[str] = None) -> list[dict]:
    """列出媒體（新到舊）。folder=None 全部、"inbox" 未分類、其他為指定資料夾。"""
    items = []
    for d in iter_media_dirs():
        if folder is not None:
            f = folder_of(d)
            if (folder == "inbox" and f is not None) or (folder != "inbox" and f != folder):
                continue
        items.append(media_summary(d))
    items.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    return items


def move_media(media_dir: Path, folder: Optional[str]) -> Path:
    """整個媒體目錄搬到另一個資料夾（folder=None 移回 inbox），並更新 job 索引。"""
    dest_base = folder_dir(folder)
    if folder and not dest_base.exists():
        raise FileNotFoundError(f"資料夾不存在: {folder}")
    dest = dest_base / media_dir.name
    shutil.move(str(media_dir), str(dest))
    _reindex_jobs(dest)
    return dest


def delete_media(media_dir: Path) -> None:
    """刪除媒體（含原始檔與所有轉錄結果）。執行中的任務會因 job 檔消失而自行中止。"""
    for p in (media_dir / "jobs").glob("*.json"):
        _JOB_PATHS.pop(p.stem, None)
        _ACTIVE_JOBS.discard(p.stem)
    shutil.rmtree(media_dir)


# ---------- folders ----------

def list_folders() -> list[dict]:
    """列出 library 下所有資料夾與各自的媒體數量（依名稱排序）。"""
    folders = []
    if config.LIBRARY_DIR.exists():
        for d in sorted(config.LIBRARY_DIR.iterdir()):
            if d.is_dir():
                folders.append({
                    "name": d.name,
                    "media_count": sum(1 for m in d.iterdir() if (m / "meta.json").exists()),
                })
    return folders


def create_folder(name: str) -> None:
    """建立資料夾；名稱不合法丟 ValueError、已存在丟 FileExistsError。"""
    if not valid_folder_name(name):
        raise ValueError("資料夾名稱不可包含 / 或以 . 開頭，長度 1–80")
    path = config.LIBRARY_DIR / name
    if path.exists():
        raise FileExistsError(f"資料夾已存在: {name}")
    path.mkdir(parents=True)


def rename_folder(old: str, new: str) -> None:
    """改名資料夾（rename 目錄本身），並重建夾內所有 job 的路徑索引。"""
    if not valid_folder_name(new):
        raise ValueError("資料夾名稱不合法")
    src, dst = config.LIBRARY_DIR / old, config.LIBRARY_DIR / new
    if not src.exists():
        raise FileNotFoundError(f"資料夾不存在: {old}")
    if dst.exists():
        raise FileExistsError(f"資料夾已存在: {new}")
    src.rename(dst)
    for d in dst.iterdir():
        if d.is_dir():
            _reindex_jobs(d)


def delete_folder(name: str) -> int:
    """刪除資料夾；內含媒體先移回 inbox（不破壞資料）。回傳移動數量。"""
    path = config.LIBRARY_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"資料夾不存在: {name}")
    moved = 0
    for d in list(path.iterdir()):
        if d.is_dir() and (d / "meta.json").exists():
            move_media(d, None)
            moved += 1
    shutil.rmtree(path)
    return moved


# ---------- jobs ----------

def _reindex_jobs(media_dir: Path) -> None:
    """媒體目錄搬移/資料夾改名後，重建夾內 job 的路徑索引。"""
    for p in (media_dir / "jobs").glob("*.json"):
        if not p.name.endswith(".segments.json"):
            _JOB_PATHS[p.stem] = p


def new_job_id() -> str:
    """任務 ID：job- 前綴 + 8 位隨機 hex。"""
    return "job-" + secrets.token_hex(4)


def create_job(media_dir: Path, job_type: str, **fields: Any) -> dict:
    """建立新任務並寫入 jobs/<id>.json。

    job_type: "transcribe"（額外欄位 model/language/diarization/denoise）
              或 "download"（額外欄位 url/format）。
    """
    job = {
        "id": new_job_id(),
        "type": job_type,  # transcribe | download
        "media_id": media_dir.name,
        "status": "queued",  # queued -> processing -> done | error
        "stage": None,       # fetch_model | denoise | transcribe | diarize | export | download
        "progress": 0,
        "error_message": None,
        "created_at": now_iso(),
        "completed_at": None,
        **fields,
    }
    path = media_dir / "jobs" / f"{job['id']}.json"
    atomic_write_json(path, job)
    _JOB_PATHS[job["id"]] = path
    _ACTIVE_JOBS.add(job["id"])
    return job


def job_path(job_id: str) -> Optional[Path]:
    """job ID → 檔案路徑：先查記憶體索引，miss 時掃描全部媒體目錄重建。"""
    p = _JOB_PATHS.get(job_id)
    if p and p.exists():
        return p
    for d in iter_media_dirs():  # 重啟後 fallback 掃描
        cand = d / "jobs" / f"{job_id}.json"
        if cand.exists():
            _JOB_PATHS[job_id] = cand
            return cand
    return None


def get_job(job_id: str) -> Optional[dict]:
    """讀取任務狀態；不存在回傳 None。"""
    p = job_path(job_id)
    return read_json(p) if p else None


def update_job(job_id: str, **patch: Any) -> dict:
    """部分更新任務並回傳更新後全貌（worker 靠回傳值檢查 cancel_requested）。

    job 檔已消失（媒體被刪）時丟 FileNotFoundError、已是終態時丟 JobClosed，讓執行中的
    worker 中止。狀態進入終態（done/error/cancelled）時自動補寫 completed_at，並移出進行中集合。
    """
    with _lock:
        p = job_path(job_id)
        if p is None:
            # 媒體被刪除時 job 檔一併消失；讓執行中的 pipeline 中止
            _ACTIVE_JOBS.discard(job_id)
            raise FileNotFoundError(f"job 已不存在: {job_id}")
        job = read_json(p)
        if job.get("status") not in _ACTIVE_STATUSES:
            # 終態不可再改：避免舊 process 的進度寫入把中斷的任務寫回 processing
            _ACTIVE_JOBS.discard(job_id)
            raise JobClosed(f"job 已結束: {job_id}")
        job.update(patch)
        if patch.get("status") in ("done", "error", "cancelled") and not job.get("completed_at"):
            job["completed_at"] = now_iso()
        if job.get("status") not in _ACTIVE_STATUSES:
            _ACTIVE_JOBS.discard(job_id)
        atomic_write_json(p, job)
        return job


def request_cancel(job_id: str) -> dict:
    """標記取消旗標；worker 在下一個進度回報點看到後中止（協作式取消）。"""
    job = get_job(job_id)
    if job is None:
        raise FileNotFoundError(f"job 已不存在: {job_id}")
    if job.get("status") not in _ACTIVE_STATUSES:
        raise ValueError("任務已結束，無法終止")
    try:
        return update_job(job_id, cancel_requested=True)
    except JobClosed:
        raise ValueError("任務已結束，無法終止") from None  # 檢查後的瞬間剛好結束


def _iter_job_files() -> Iterator[tuple[Path, Path]]:
    """走訪全部 job 檔，回傳 (媒體目錄, job 檔路徑)。"""
    for d in iter_media_dirs():
        for p in (d / "jobs").glob("*.json"):
            if not p.name.endswith(".segments.json"):
                yield d, p


def _with_title(job: dict, media_dir: Path) -> dict:
    try:
        job["media_title"] = read_json(media_dir / "meta.json").get("title")
    except Exception:
        job["media_title"] = None
    return job


def list_jobs(active_only: bool = False) -> list[dict]:
    """列出所有任務（附 media_title，新到舊）。active_only 只回 queued/processing。

    active_only 只讀 _ACTIVE_JOBS 裡的 job 檔（前端每 2 秒輪詢），其餘情況掃遍全部。
    """
    jobs = []
    if active_only:
        for job_id in tuple(_ACTIVE_JOBS):
            p = job_path(job_id)
            try:
                job = read_json(p) if p else None
            except Exception:
                continue  # 寫入中或剛被搬移，下一輪再讀
            if job is None or job.get("status") not in _ACTIVE_STATUSES:
                _ACTIVE_JOBS.discard(job_id)
                continue
            jobs.append(_with_title(job, p.parent.parent))
    else:
        for d, p in _iter_job_files():
            try:
                jobs.append(_with_title(read_json(p), d))
            except Exception:
                continue
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs


def recover_interrupted_jobs() -> int:
    """啟動時呼叫：前一個 process 留下的 queued/processing 任務標為 error，回傳筆數。

    BackgroundTasks 不會跨重啟續跑，不處理的話這些任務會永遠顯示進行中、也終止不了。
    順便建立 _JOB_PATHS 索引。
    """
    count = 0
    for _, p in _iter_job_files():
        _JOB_PATHS[p.stem] = p
        try:
            status = read_json(p).get("status")
        except Exception:
            continue
        if status in _ACTIVE_STATUSES:
            update_job(p.stem, status="error", stage=None,
                       error_message="後端重新啟動，任務已中斷")
            count += 1
    return count


def segments_path(job_id: str) -> Optional[Path]:
    """轉錄結果檔路徑 jobs/<id>.segments.json（單一真實來源，匯出即時產生）。"""
    p = job_path(job_id)
    if p is None:
        return None
    return p.with_name(f"{job_id}.segments.json")
