# CLAUDE.md

本檔案為 Claude Code 在此專案工作時的指引。

## 專案概述

深海聲納——單人本地工具：YouTube 下載 + MLX Whisper 轉錄（Apple Silicon Metal 加速）+ 說話者識別 + AI 降噪 + TXT/SRT/DOCX 匯出。無帳號、無資料庫、無 Docker。完整實作說明見 [詳細實作說明.md](詳細實作說明.md)。

## 常用指令

```bash
./manage.sh start      # 啟動前後端 → http://localhost:3000
./manage.sh stop       # 完全關閉
./manage.sh restart    # 後端程式碼變更後必須；前端有 Vite HMR 通常不用
./manage.sh status     # 查看 pid 狀態
./manage.sh logs       # 兩邊最後 40 行日誌（.run/*.log）

cd frontend && npx tsc -b                                    # 前端型別檢查
backend/.venv/bin/python -c "from app.main import app"       # 後端 import 驗證
```

## 架構速覽

- **後端** `backend/`：FastAPI + Python 3.12（`.venv`）。任務用 BackgroundTasks（同步函式進 threadpool），狀態寫回 JSON 檔
- **前端** `frontend/`：Vite 7 + React 19 + Tailwind 4 + framer-motion。Node 22（`.nvmrc`，nvm）。`/api` 由 Vite proxy 轉 127.0.0.1:8000
- **儲存**：檔案系統即資料庫。`data/inbox/<id>/`（未分類）與 `data/library/<資料夾>/<id>/`，每個媒體目錄含 `source.*`、`meta.json`、`jobs/*.json`、`jobs/*.segments.json`。JSON 一律原子寫入（tmp+rename）
- **任務狀態機**：`queued → processing → done | error | cancelled`。終止 = 設 `cancel_requested` 旗標，worker 在下個進度回報點（`storage.update_job` 回傳值）拋 `JobCancelled`——協作式取消，勿嘗試強殺執行緒
- **前端輪詢**：`AppContext` 每 2s（活躍）/6s（閒置）抓 `/api/jobs?active=true`；任務離開 active 集合時 `jobsVersion++` 觸發各頁刷新

## 關鍵約束（改壞會很難查）

- **模型位置**：`HF_HOME` 在 `config.py` 指到 `<專案>/models`，所有 HF 模型下載後永久存在 `models/hub/`，不用 `~/.cache/huggingface`
- **mlx 模型名**：`whisper-small-mlx`、`whisper-large-v3-mlx` 帶 `-mlx` 後綴，`whisper-large-v3-turbo` 沒有（HF 實際 repo 名，寫錯會 404）
- **numpy 鎖版** `>=2.2.2,<2.5`：numba 上限 vs pyannote-metrics/scipy 下限
- **降噪**：用官方 Rust 執行檔 `backend/bin/deep-filter`；DeepFilterNet 的 pip 套件已停更且會降級 numpy，**不要安裝**
- **pyannote 4.x**：pipeline 回傳 `DiarizeOutput`，Annotation 在 `.speaker_diarization` 屬性；強制 CPU（MPS 不相容）
- **HF_TOKEN** 在根目錄 `.env`（gitignore），pyannote gated model 用；帳號需在 HF 網站接受 `pyannote/speaker-diarization-community-1` 條款
- **中文輸出**：zh 結果一律過 OpenCC（segments 用 s2twp、words 用 s2t），不要移除

## 慣例

- 註解與 UI 文案用繁體中文；錯誤訊息要可讀化（見 `downloader._readable_error`）
- 新增 API 後同步更新 `frontend/src/lib/api.ts` 與 `types.ts`
- 破壞性操作前端要過 `ConfirmDialog`
- UI 形狀：容器圓角只用 `rounded-panel`(24) → `rounded-row`(16) → `rounded-tile`(8)，每往內一層 `p-2` 就降一級（同心）；控制項一律 `rounded-full`，高度只用 32/40/48。狀態標籤用 `Badge`、選單用 `Menu`、帶欄位名的資訊用 `MetaLine`/`InfoItem`（都在 `components/ui.tsx`），不要自己手寫
