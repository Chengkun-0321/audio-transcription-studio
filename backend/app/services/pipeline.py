"""轉錄任務編排：denoise → transcribe（‖ diarize）→ 寫入 segments.json。

在 FastAPI BackgroundTasks 的 threadpool 執行（同步函式）。轉錄任務一次只跑一個
（_job_lock 排隊）：GPU 本來就是瓶頸，並行只會讓模型與 activation 疊加佔記憶體，
且 mlx_whisper 的 ModelHolder 只有一個槽位，不同模式交錯會每塊重載模型。
開啟說話者識別時，pyannote 在子行程與 Whisper 同時跑（diarizer.Diarization）。
每個階段依權重把 0–100 的進度寫回 job JSON 供前端輪詢；只有主執行緒寫 job 檔。
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
from .audio import load_audio


# 執行中＋排隊中的轉錄任務數；歸零時釋放模型
_active_lock = threading.Lock()
_active_jobs = 0
# 轉錄任務一次只跑一個；等待中的任務維持 queued（前端顯示「排隊中」）
_job_lock = threading.Lock()


class JobCancelled(Exception):
    """使用者要求終止；在進度回報點拋出以中止整條 pipeline。"""


def _release_models() -> None:
    """釋放 Whisper 模型與 MLX Metal 快取，閒置時不佔數 GB 記憶體。

    只清已載入的模組，不為了釋放反而 import mlx；下個任務會從 models/ 重新載入（數秒）。
    mlx_whisper 的 ModelHolder 是類別層級快取，不清會永久持有最後用過的模型。
    pyannote 在子行程執行，任務結束即隨行程釋放，不需要在這裡處理。
    """
    holder = sys.modules.get("mlx_whisper.transcribe")
    if holder is not None:
        holder.ModelHolder.model = None
        holder.ModelHolder.model_path = None
    gc.collect()  # 先回收陣列，再清掉 MLX 留作重用的 Metal buffer
    mx = sys.modules.get("mlx.core")
    if mx is not None:
        mx.clear_cache()


def run_transcribe_job(job_id: str, media_dir: Path) -> None:
    """轉錄任務主流程：排隊 → denoise（選）→ transcribe ‖ diarize（選）→ 寫 segments.json。

    進度依階段權重合成為 0–100 寫回 job JSON；每次寫入同時檢查
    cancel_requested 旗標，實現協作式取消。最後一個任務結束時釋放模型。
    """
    global _active_jobs
    with _active_lock:
        _active_jobs += 1  # 排隊中也計入：前一個任務結束時不釋放下一個要用的模型
    try:
        if _wait_turn(job_id):
            try:
                _run(job_id, media_dir)
            finally:
                _job_lock.release()
    finally:
        # 釋放也在鎖內：避免剛開始的新任務載入模型後又被清掉
        with _active_lock:
            _active_jobs -= 1
            if _active_jobs == 0:
                _release_models()


def _wait_turn(job_id: str) -> bool:
    """排隊等 _job_lock，每秒檢查一次取消。拿到鎖回傳 True（呼叫端負責釋放）。"""
    while not _job_lock.acquire(timeout=1.0):
        try:
            job = storage.get_job(job_id)
            if job is None:
                return False
            if job.get("cancel_requested"):
                storage.update_job(job_id, status="cancelled", stage=None)
                return False
        except FileNotFoundError:
            return False  # 排隊中媒體被刪除
    return True


def _run(job_id: str, media_dir: Path) -> None:
    job = storage.get_job(job_id)
    if job is None:
        return
    src = storage.source_file(media_dir)

    # 進度權重：有開的階段才佔比例；說話者識別與轉錄並行，進度取各階段完成度的加權和
    weights = {"denoise": 15 if job["denoise"] else 0,
               "transcribe": 70,
               "diarize": 25 if job["diarization"] else 0}
    total_w = sum(weights.values())
    fracs = dict.fromkeys(weights, 0.0)
    diar = None  # diarizer.Diarization（子行程）

    def report(stage: str, frac: float) -> None:
        """寫進度並檢查取消；說話者識別子行程失敗也在這裡提早拋出，不必等 Whisper 跑完。"""
        fracs[stage] = min(frac, 1.0)
        if diar is not None:
            if diar.done():
                diar.result()
            fracs["diarize"] = diar.progress
        pct = round(sum(weights[k] * fracs[k] for k in weights) / total_w * 100)
        updated = storage.update_job(job_id, status="processing", stage=stage, progress=pct)
        if updated.get("cancel_requested"):
            raise JobCancelled

    try:
        if src is None:
            raise RuntimeError("找不到媒體來源檔")
        if job.get("cancel_requested"):  # 還在排隊就被取消
            raise JobCancelled
        storage.update_job(job_id, status="processing", progress=0)

        if job["diarization"]:
            from . import diarizer
            # 用原始檔而非降噪檔做 diarization（speaker embedding 對原聲更穩）
            diar = diarizer.Diarization(src, job.get("num_speakers"))

        if job["denoise"]:
            from . import denoiser  # 延遲 import：不用不載
            report("denoise", 0.0)
            with tempfile.TemporaryDirectory() as tmp:
                speech = load_audio(denoiser.denoise(src, Path(tmp) / "enhanced.wav"))
            report("denoise", 1.0)
        else:
            speech = load_audio(src)

        lang = None if job["language"] in (None, "", "auto") else job["language"]
        # 先標上階段：載入模型＋第一塊可能要數十秒，stage 空著前端會顯示成「排隊中」
        report("transcribe", 0.0)
        result = transcriber.transcribe(
            speech, job["mode"], lang,
            on_progress=lambda f: report("transcribe", f),
        )
        del speech
        segments = result["segments"]

        if diar is not None and segments:
            while not diar.done():
                report("diarize", diar.progress)
                diar.wait(1.0)
            segments = diarizer.assign_speakers(segments, diar.result(), result["language"])

        seg_path = storage.segments_path(job_id)
        if seg_path is None:
            return  # 媒體已被刪除
        storage.atomic_write_json(seg_path, {
            "language": result["language"],
            "segments": segments,
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
    finally:
        if diar is not None:
            diar.close()  # 取消/失敗/無語音時子行程可能還在跑：直接終止，下個任務不會與它重疊
