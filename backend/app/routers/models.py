"""模型 API：Whisper 模型清單與本機狀態、預先下載、取消下載、刪除。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import config
from ..services import models

router = APIRouter(prefix="/api/models", tags=["models"])


def _check(key: str) -> None:
    if key not in config.WHISPER_MODELS:
        raise HTTPException(404, f"未知的模型: {key}")


@router.get("")
def list_models():
    """全部模型（固定順序）＋是否已下載、下載進度、佔用空間、是否被任務使用中。"""
    return models.list_models()


@router.post("/{key}/download")
def download(key: str):
    """背景下載模型（立即回應，進度靠輪詢列表）；已下載或下載中則無動作。"""
    _check(key)
    models.start_download(key)
    return {"ok": True}


@router.post("/{key}/cancel")
def cancel(key: str):
    """取消模型頁發起的下載；已下載的部分保留供下次續傳。"""
    _check(key)
    try:
        models.cancel_download(key)
    except models.ModelBusy as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@router.delete("/{key}")
def delete(key: str):
    """刪除本機模型檔；下次使用會自動重新下載。"""
    _check(key)
    try:
        models.delete(key)
    except models.ModelBusy as e:
        raise HTTPException(409, str(e))
    return {"ok": True}
