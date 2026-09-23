# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

深海聲納——單人本地工具：YouTube 下載 + MLX Whisper 轉錄（Apple Silicon Metal 加速）+ 說話者識別 + AI 降噪 + TXT/SRT/DOCX 匯出。無帳號、無資料庫、無 Docker，所有運算在本機。實作細節見 [詳細實作說明.md](詳細實作說明.md)，新機安裝與 HF 授權步驟見 [INSTALLATION_AND_MODELS.md](INSTALLATION_AND_MODELS.md)。[AGENTS.md](AGENTS.md) 是給 Codex 的同內容指引，改動約束時兩邊一起更新。

## 常用指令

```bash
./manage.sh start      # 啟動前後端 → http://localhost:3000
./manage.sh stop       # 完全關閉
./manage.sh restart    # 後端程式碼變更後必須（uvicorn 未開 --reload）；前端有 Vite HMR 通常不用
./manage.sh status     # 查看 pid 狀態
./manage.sh logs       # 兩邊最後 40 行日誌（.run/*.log）

cd frontend && npx tsc -b                                    # 前端型別檢查（npm run build = tsc -b + vite build）
cd backend && .venv/bin/python -c "from app.main import app" # 後端 import 驗證（必須在 backend/ 下執行，根目錄會找不到 app）
```

- **沒有測試套件與 linter**，驗證靠上面兩個指令 + 實際跑一次功能
- 首次安裝：`python3.12 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt`；前端 `source ~/.nvm/nvm.sh && cd frontend && nvm use && npm ci`。系統需裝 `ffmpeg`/`ffprobe`
- `.claude/launch.json` 有 `frontend`、`backend` 兩個 preview 設定（Port 寫死 3000/8000，不讀 `.env`）

## 架構

### 後端 `backend/app/`（FastAPI + Python 3.12）

- `config.py` 是最先 import 的模組：讀根目錄 `.env`、設 `HF_HOME`，必須在任何 HF 套件載入前完成。路徑、`MODE_MODELS`、允許副檔名都集中在此
- `routers/`（media / folders / jobs）只做驗證與呼叫；`storage.py` 是唯一碰檔案系統的層；`services/` 是實際工作
- 長任務用 `BackgroundTasks` 丟 threadpool 跑**同步函式**：轉錄 → `pipeline.run_transcribe_job`，下載 → `downloader.download`
- 轉錄流程：`denoise`（選，Rust `deep-filter`）→ `transcriber`（ffmpeg 解碼 16k → silero-vad 切段 → ≤120s 塊逐塊 mlx-whisper → 時間戳映射回原軸）→ `diarize`（選，pyannote）→ 寫 `segments.json`
  - VAD 語音覆蓋率 <20%（歌曲/音樂）時放棄 VAD 整段均分；`auto` 語言在第一塊偵測後鎖定
  - 說話者識別刻意吃**原始檔**而非降噪檔；`denoiser`/`diarizer` 在 pipeline 內延遲 import（torch 不用不載）
  - 進度權重 denoise 15 / transcribe 70 / diarize 25，未開啟的階段不佔比
- `segments.json` 是轉錄結果的單一真實來源，TXT/SRT/DOCX 由 `exporter.py` 即時產生，不存副本

### 儲存（檔案系統即資料庫）

- `data/inbox/<id>/`（未分類）與 `data/library/<資料夾>/<id>/`；每個媒體目錄含 `source.*`、`meta.json`、`jobs/<job-id>.json`、`jobs/<job-id>.segments.json`
- 搬移/改名資料夾 = 搬目錄；JSON 一律 `atomic_write_json`（tmp + rename），前端輪詢不會讀到半成品
- `storage._JOB_PATHS` 是 job-id → 路徑的記憶體索引（假設單一 uvicorn process）；任何搬動目錄的操作後要 `_reindex_jobs`，miss 時會 fallback 掃描

### 任務狀態機與取消

- `queued → processing → done | error | cancelled`，`storage.update_job` 進終態時自動補 `completed_at`
- 終止 = 設 `cancel_requested` 旗標；worker 在下個進度回報點（`update_job` 回傳值）拋 `JobCancelled`——協作式取消，勿嘗試強殺執行緒
- 第三方庫（yt-dlp、pyannote hook）會把 `JobCancelled` 包成別的例外，所以 `except Exception` 分支要再以旗標判斷是否為取消
- 執行中媒體被刪 → job 檔消失 → `update_job` 拋 `FileNotFoundError` → worker 安靜結束
- 下載任務取消會連媒體條目一起刪；下載進度刻意停在 90/92% 保留給合併/轉檔

### 前端 `frontend/src/`（Vite 7 + React 19 + Tailwind 4 + framer-motion，Node 22）

- 路由：`/` 下載器、`/library` 媒體庫、`/media/:id` 播放器 + 逐字稿
- `AppContext`：全域 toast + 每 2s（活躍）/6s（閒置）輪詢 `/api/jobs?active=true`；任務離開 active 集合時 `jobsVersion++`，頁面把它放進 `useEffect` 依賴即自動刷新；建立/終止任務後呼叫 `refreshJobs()`
- `lib/api.ts` 一律用相對路徑 `/api`（Vite proxy 轉後端）；上傳用 XHR 取得進度
- 前端綁 `0.0.0.0`（區網可連），後端只綁 `127.0.0.1`——區網存取靠 Vite proxy，不要讓前端直連後端 Port

## 關鍵約束（改壞會很難查）

- **Port 單一來源**：根目錄 `.env` 的 `FRONTEND_PORT`/`BACKEND_PORT` 同時被 `manage.sh`、`vite.config.ts`、`config.py`（CORS）讀取。`manage.sh` 只認這兩個 key 與 `HF_TOKEN`，新增 `.env` 欄位要同步改它的解析規則
- **模型位置**：`config.py` 用 `os.environ["HF_HOME"] = <專案>/models`（刻意覆寫，非 setdefault），所有 HF 模型存在 `models/hub/`
- **mlx 模型名**：`whisper-small-mlx`、`whisper-large-v3-mlx` 帶 `-mlx` 後綴，`whisper-large-v3-turbo` 沒有（HF 實際 repo 名，寫錯會 404）
- **numpy 鎖版** `>=2.2.2,<2.5`：numba 上限 vs pyannote-metrics/scipy 下限
- **降噪**：用官方 Rust 執行檔 `backend/bin/deep-filter`（進版控）；DeepFilterNet 的 pip 套件已停更且會降級 numpy，**不要安裝**
- **pyannote 4.x**：pipeline 回傳 `DiarizeOutput`，Annotation 在 `.speaker_diarization`；強制 CPU（MPS 不相容）
- **HF_TOKEN** 在根目錄 `.env`（gitignore），pyannote gated model 用；帳號需在 HF 網站接受 `pyannote/speaker-diarization-community-1` 條款
- **中文輸出**：zh 結果一律過 OpenCC（segments 用 s2twp、words 用 s2t 保持字數對齊），不要移除
- **前後端對應**：轉錄模式 key（cheetah/dolphin/whale）與 job `stage` 名稱在 `config.MODE_MODELS` 與 `frontend/src/lib/format.ts`（`MODE_INFO`、`STAGE_LABEL`）兩邊都要改

## 慣例

- 註解與 UI 文案用繁體中文；錯誤訊息要可讀化（見 `downloader._readable_error`、`diarizer._get_pipeline`）
- 新增 API 後同步更新 `frontend/src/lib/api.ts` 與 `types.ts`
- 破壞性操作前端要過 `ConfirmDialog`
- **顏色**：只用 `index.css` 的 CSS 變數（經 `@theme inline` 變成 `bg-surface`、`text-sonar` 等 utility），元件內不寫色票；主題由 `useTheme` 切 `.dark` class，不跟隨系統
- **玻璃材質**：導覽/控制層用 `glass`，疊在內容上的彈窗/抽屜/toast 用 `glass-strong`，內容卡片用 `glass-card`（無 backdrop-filter，避免長列表卡頓）；`glass-rim` 需要定位元素
- **UI 形狀**：容器圓角只用 `rounded-panel`(24) → `rounded-row`(16) → `rounded-tile`(8)，每往內一層 `p-2` 就降一級（同心）；控制項一律 `rounded-full`，高度只用 32/40/48。狀態標籤用 `Badge`、選單用 `Menu`、帶欄位名的資訊用 `MetaLine`/`InfoItem`（都在 `components/ui.tsx`），不要自己手寫
- 可拖曳歸檔的列表項目不要用 `motion.li`（framer-motion 會接管 `onDragStart` 破壞原生拖曳），進場動畫改用 CSS `rise-in`
