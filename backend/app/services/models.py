"""Whisper 模型快取管理：本機狀態、下載（進度＋中止）、刪除。

模型在 HF_HOME/hub（config 設為專案 models/），用 huggingface_hub 的快取格式：
models--<org>--<name>/{blobs, snapshots/<commit>, refs/main}。狀態一律看檔案系統，不連網。

轉錄任務與模型頁共用同一套下載：同一模型同時只有一條下載執行緒，其他呼叫者加入等待。
下載狀態只存在記憶體（假設單一 uvicorn process，同 storage._JOB_PATHS）。
"""
from __future__ import annotations

import os
import shutil
import threading
from pathlib import Path
from typing import Callable, Optional

from .. import config, storage

HUB_DIR = config.MODELS_DIR / "hub"
_WEIGHT_FILES = ("weights.safetensors", "weights.npz")  # mlx_whisper.load_model 只認這兩種
_DEVNULL = open(os.devnull, "w")  # noqa: SIM115 — 下載進度條的輸出丟掉，整個 process 共用


class ModelBusy(Exception):
    """模型正在下載或被轉錄任務使用，不能刪除／取消。"""


class DownloadAborted(Exception):
    """下載被中止：使用者取消，或等待中的轉錄任務全部被終止。"""


class _Download:
    """一個模型的下載狀態；n/total 由下載執行緒的進度條更新。"""

    def __init__(self, key: str):
        self.key = key
        # 各檔的 total 是抓到該檔 metadata 才加進來（config.json 常先下載完），
        # 分母至少取目錄登記的大小，否則一開始會閃現 100%
        self.expected = config.WHISPER_MODELS[key]["download_mb"] * 1_000_000
        self.done = threading.Event()
        self.abort = threading.Event()
        self.n = 0
        self.total = 0
        self.waiters = 0      # 等待中的轉錄任務數
        self.manual = False   # 模型頁手動下載：沒有任務在等也要下載完
        self.path: Optional[Path] = None
        self.error: Optional[BaseException] = None

    @property
    def progress(self) -> float:
        return min(self.n / max(self.total, self.expected), 1.0)


_lock = threading.Lock()  # 保護 _downloads，並讓狀態檢查與刪除不交錯
_downloads: dict[str, _Download] = {}


def _repo_dir(key: str) -> Path:
    return HUB_DIR / f"models--{config.WHISPER_MODELS[key]['repo'].replace('/', '--')}"


def local_path(key: str) -> Optional[Path]:
    """已完整下載時回傳 snapshot 目錄，否則 None。

    snapshot 內的檔案是指向 blobs 的 symlink，檔案下載完才會建立，
    所以 config.json 與權重檔都在（且 symlink 有效）就代表完整。
    """
    repo = _repo_dir(key)
    try:
        commit = (repo / "refs" / "main").read_text().strip()
    except OSError:
        return None
    snap = repo / "snapshots" / commit
    if (snap / "config.json").exists() and any((snap / w).exists() for w in _WEIGHT_FILES):
        return snap
    return None


def _dir_size(path: Path) -> int:
    """blobs/ 實際佔用（含下載到一半的 .incomplete）；snapshots 只有 symlink 不重複計算。"""
    try:
        return sum(e.stat().st_size for e in os.scandir(path / "blobs") if e.is_file())
    except OSError:
        return 0


def _in_use() -> set[str]:
    """排隊中或執行中的轉錄任務用到的模型。"""
    return {j.get("model") for j in storage.list_jobs(active_only=True) if j.get("type") == "transcribe"}


def list_models() -> list[dict]:
    """模型清單（config 順序）＋本機狀態，模型頁與轉錄設定共用。"""
    in_use = _in_use()
    out = []
    for key, info in config.WHISPER_MODELS.items():
        dl = _downloads.get(key)
        status = "downloading" if dl else ("downloaded" if local_path(key) else "absent")
        out.append({
            "key": key,
            **info,
            "default": key == config.DEFAULT_MODEL,
            "status": status,
            "progress": round(dl.progress * 100) if dl else None,
            "size_bytes": _dir_size(_repo_dir(key)),
            "in_use": key in in_use,
        })
    return out


def _progress_class(dl: _Download):
    """給 snapshot_download 的 tqdm_class：把彙總位元組進度寫進 dl，並在這裡檢查中止。

    必須繼承純 tqdm：huggingface_hub 自己的 tqdm 子類在非 TTY（uvicorn 背景執行）會 disable，
    disable 的進度條不累計 n。輸出導到 devnull，不寫進 backend log。
    """
    from tqdm.auto import tqdm

    class _Progress(tqdm):
        def __init__(self, *args, **kwargs):
            kwargs.update(file=_DEVNULL, disable=False, mininterval=0.5)
            super().__init__(*args, **kwargs)

        def update(self, n=1):
            if dl.abort.is_set():
                raise DownloadAborted  # 從下載執行緒內部丟出，中止 snapshot_download
            result = super().update(n)
            if self.unit == "B":  # 另一條是「檔案數」進度條，不看
                dl.n, dl.total = self.n, self.total or 0
            return result

    return _Progress


def _download(dl: _Download) -> None:
    """下載執行緒：只抓 config.json 與權重檔（README 等用不到）。"""
    from huggingface_hub import snapshot_download

    try:
        dl.path = Path(snapshot_download(
            repo_id=config.WHISPER_MODELS[dl.key]["repo"],
            allow_patterns=["config.json", *_WEIGHT_FILES],
            tqdm_class=_progress_class(dl),
        ))
    except BaseException as e:  # noqa: BLE001 — 交給等待者判讀，不能讓執行緒默默死掉
        dl.error = e
    finally:
        with _lock:
            _downloads.pop(dl.key, None)
        dl.done.set()


def _join(key: str, *, manual: bool) -> Path | _Download:
    """已下載回傳路徑；否則開始（或加入）下載並回傳下載狀態。

    前一次下載已被中止但執行緒還沒收尾時，等它結束再重開，不接手注定失敗的下載。
    """
    while True:
        with _lock:
            path = local_path(key)
            if path is not None:
                return path
            dl = _downloads.get(key)
            if dl is None or not dl.abort.is_set():
                if dl is None:
                    dl = _downloads[key] = _Download(key)
                    threading.Thread(target=_download, args=(dl,), daemon=True,
                                     name=f"model-download-{key}").start()
                if manual:
                    dl.manual = True
                else:
                    dl.waiters += 1
                return dl
        dl.done.wait()


def _readable_error(e: BaseException) -> str:
    if isinstance(e, DownloadAborted):
        return "模型下載已取消"
    return f"模型下載失敗，請確認網路連線後重試（{type(e).__name__}: {e}）"[:300]


def ensure(key: str, on_progress: Callable[[float], None] = lambda f: None) -> Path:
    """回傳模型的本機 snapshot 路徑；還沒下載就下載，阻塞到完成。

    下載期間每 0.5 秒在呼叫端執行緒呼叫 on_progress(0.0–1.0)；它可以丟例外（JobCancelled）
    中止等待。最後一個等待者離開、又不是模型頁手動下載時，下載本身也一併中止。
    """
    dl = _join(key, manual=False)
    if isinstance(dl, Path):
        return dl
    try:
        while not dl.done.wait(0.5):
            on_progress(dl.progress)
    finally:
        with _lock:
            dl.waiters -= 1
            if dl.waiters == 0 and not dl.manual and not dl.done.is_set():
                dl.abort.set()
    if dl.error is not None:
        raise RuntimeError(_readable_error(dl.error)) from dl.error
    assert dl.path is not None
    return dl.path


def start_download(key: str) -> None:
    """模型頁「下載」：在背景下載，不阻塞請求。已下載或下載中則無動作。"""
    _join(key, manual=True)


def cancel_download(key: str) -> None:
    """模型頁「取消下載」；有轉錄任務在等這個模型時拒絕（應改為終止該任務）。"""
    with _lock:
        dl = _downloads.get(key)
        if dl is None:
            return
        if dl.waiters:
            raise ModelBusy("有轉錄任務正在等這個模型下載，請從任務列表終止該任務")
        dl.manual = False
        dl.abort.set()


def delete(key: str) -> None:
    """刪除本機模型（含下載到一半的檔案）；下次使用會重新下載。"""
    with _lock:
        if key in _downloads:
            raise ModelBusy("模型下載中，請先取消下載")
        if key in _in_use():
            raise ModelBusy("有轉錄任務正在使用這個模型，請等任務結束或先終止")
        repo = _repo_dir(key)
        for path in (repo, HUB_DIR / ".locks" / repo.name):
            if path.exists():
                shutil.rmtree(path)
