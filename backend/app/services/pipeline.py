"""轉錄任務編排：denoise → transcribe → diarize → 寫入 segments.json。

在 FastAPI BackgroundTasks 的 threadpool 執行（同步函式），
每個階段依權重把 0–100 的進度寫回 job JSON 供前端輪詢。
"""
from __future__ import annotations

import gc
import sys
import tempfile
import threading
import traceback
from pathlib import Path

from .. import storage
from . import transcriber


# 執行中的轉錄任務數（threadpool 可能同時跑多個）；歸零時釋放模型
_active_lock = threading.Lock()
_active_jobs = 0


class JobCancelled(Exception):
    """使用者要求終止；在進度回報點拋出以中止整條 pipeline。"""


def _release_models() -> None:
    """釋放 Whisper / pyannote 模型與 MLX Metal 快取，閒置時不佔數 GB 記憶體。

    只清已載入的模組，不為了釋放反而 import mlx/torch；下個任務會從 models/ 重新載入（數秒）。
    mlx_whisper 的 ModelHolder 是類別層級快取，不清會永久持有最後用過的模型。
    """
    holder = sys.modules.get("mlx_whisper.transcribe")
    if holder is not None:
        holder.ModelHolder.model = None
        holder.ModelHolder.model_path = None
    diarizer = sys.modules.get(f"{__package__}.diarizer")
    if diarizer is not None:
        diarizer._pipeline = None
    gc.collect()  # 先回收陣列，再清掉 MLX 留作重用的 Metal buffer
    mx = sys.modules.get("mlx.core")
    if mx is not None:
        mx.clear_cache()


def run_transcribe_job(job_id: str, media_dir: Path) -> None:
    """轉錄任務主流程：denoise（選）→ transcribe → diarize（選）→ 寫 segments.json。

    進度依階段權重合成為 0–100 寫回 job JSON；每次寫入同時檢查
    cancel_requested 旗標，實現協作式取消。最後一個任務結束時釋放模型。
    """
    global _active_jobs
    with _active_lock:
        _active_jobs += 1
    try:
        _run(job_id, media_dir)
    finally:
        # 釋放也在鎖內：避免剛開始的新任務載入模型後又被清掉
        with _active_lock:
            _active_jobs -= 1
            if _active_jobs == 0:
                _release_models()


def _run(job_id: str, media_dir: Path) -> None:
    job = storage.get_job(job_id)
    if job is None:
        return
    src = storage.source_file(media_dir)

    # 進度權重：有開的階段才佔比例
    weights = {"denoise": 15 if job["denoise"] else 0,
               "transcribe": 70,
               "diarize": 25 if job["diarization"] else 0}
    total_w = sum(weights.values())
    base = 0.0

    def report(stage: str, frac: float) -> None:
        pct = round((base + weights[stage] * min(frac, 1.0)) / total_w * 100)
        updated = storage.update_job(job_id, status="processing", stage=stage, progress=pct)
        if updated.get("cancel_requested"):
            raise JobCancelled

    try:
        if src is None:
            raise RuntimeError("找不到媒體來源檔")
        if job.get("cancel_requested"):  # 還在排隊就被取消
            raise JobCancelled
        storage.update_job(job_id, status="processing", progress=0)

        with tempfile.TemporaryDirectory() as tmp:
            audio_path = src
            if job["denoise"]:
                from . import denoiser  # 延遲 import：torch 模型不用不載
                report("denoise", 0.0)
                audio_path = denoiser.denoise(src, Path(tmp) / "enhanced.wav")
                report("denoise", 1.0)
                base += weights["denoise"]

            lang = None if job["language"] in (None, "", "auto") else job["language"]
            result = transcriber.transcribe(
                audio_path, job["mode"], lang,
                on_progress=lambda f: report("transcribe", f),
            )
            base += weights["transcribe"]

            if job["diarization"] and result["segments"]:
                from . import diarizer
                # 用原始檔而非降噪檔做 diarization（speaker embedding 對原聲更穩）
                diarizer.assign_speakers(src, result["segments"],
                                         on_progress=lambda f: report("diarize", f))
                base += weights["diarize"]

        seg_path = storage.segments_path(job_id)
        if seg_path is None:
            return  # 媒體已被刪除
        storage.atomic_write_json(seg_path, {
            "language": result["language"],
            "segments": result["segments"],
        })
        storage.update_job(job_id, status="done", stage=None, progress=100,
                           detected_language=result["language"])
    except JobCancelled:
        try:
            storage.update_job(job_id, status="cancelled", stage=None)
        except FileNotFoundError:
            pass
    except FileNotFoundError:
        pass  # job/媒體在執行途中被刪除
    except Exception as e:  # noqa: BLE001 — 失敗必須寫回 job，不能無聲吞掉
        try:
            # hook 內拋出的 JobCancelled 可能被第三方庫包裝，統一以旗標判斷
            if (storage.get_job(job_id) or {}).get("cancel_requested"):
                storage.update_job(job_id, status="cancelled", stage=None)
                return
            traceback.print_exc()
            storage.update_job(job_id, status="error", stage=None,
                               error_message=str(e)[:500])
        except FileNotFoundError:
            pass
