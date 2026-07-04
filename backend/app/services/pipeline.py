"""轉錄任務編排：denoise → transcribe → diarize → 寫入 segments.json。

在 FastAPI BackgroundTasks 的 threadpool 執行（同步函式），
每個階段依權重把 0–100 的進度寫回 job JSON 供前端輪詢。
"""
from __future__ import annotations

import tempfile
import traceback
from pathlib import Path

from .. import storage
from . import transcriber


class JobCancelled(Exception):
    """使用者要求終止；在進度回報點拋出以中止整條 pipeline。"""


def run_transcribe_job(job_id: str, media_dir: Path) -> None:
    """轉錄任務主流程：denoise（選）→ transcribe → diarize（選）→ 寫 segments.json。

    進度依階段權重合成為 0–100 寫回 job JSON；每次寫入同時檢查
    cancel_requested 旗標，實現協作式取消。
    """
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
