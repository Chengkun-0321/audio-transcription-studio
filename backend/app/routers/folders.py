"""資料夾 API：列表、建立、改名、刪除（實體目錄即資料夾）。"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import storage

router = APIRouter(prefix="/api/folders", tags=["folders"])


class FolderReq(BaseModel):
    name: str


@router.get("")
def list_folders():
    """所有資料夾與各自媒體數（前端側欄用）。"""
    return storage.list_folders()


@router.post("")
def create(req: FolderReq):
    """建立資料夾；名稱不合法或已存在回 400。"""
    try:
        storage.create_folder(req.name.strip())
    except (ValueError, FileExistsError) as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "name": req.name.strip()}


@router.patch("/{name}")
def rename(name: str, req: FolderReq):
    """資料夾改名（body 的 name 為新名稱）。"""
    try:
        storage.rename_folder(name, req.name.strip())
    except (ValueError, FileExistsError) as e:
        raise HTTPException(400, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    return {"ok": True, "name": req.name.strip()}


@router.delete("/{name}")
def delete(name: str):
    """刪除資料夾；夾內媒體自動移回「未分類」，不刪媒體。"""
    try:
        moved = storage.delete_folder(name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    return {"ok": True, "moved_to_inbox": moved}
