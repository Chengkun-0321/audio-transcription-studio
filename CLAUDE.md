# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

深海聲納——單人本地工具：YouTube 下載 + MLX Whisper 轉錄（Apple Silicon Metal 加速）+ 說話者識別 + AI 降噪 + TXT/SRT/DOCX 匯出。無帳號、無資料庫、無 Docker，所有運算在本機。實作細節見 [詳細實作說明.md](詳細實作說明.md)，新機安裝與 HF 授權步驟見 [INSTALLATION_AND_MODELS.md](INSTALLATION_AND_MODELS.md)。[AGENTS.md](AGENTS.md) 是給 Codex 的同內容指引，改動約束時兩邊一起更新。

## 常用指令

```bash
./manage.sh start      # 正式模式（日常用）→ http://localhost:3000：前端有變動才 vite build，再以 vite preview 提供
./manage.sh dev        # 開發模式：前端跑 Vite dev server（HMR）
./manage.sh stop       # 完全關閉
./manage.sh restart    # 沿用上次模式重啟；後端改動必須（uvicorn 未開 --reload），正式模式下前端改動也要
./manage.sh status     # 查看 pid 與前端模式
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
- 轉錄任務以 `pipeline._job_lock` **一次只跑一個**，等待中維持 `queued`（每秒檢查取消）：mlx_whisper 的 `ModelHolder` 只有一個槽位，並行不同模式會每塊重載模型、記憶體疊加
- 轉錄流程：`denoise`（選，Rust `deep-filter`）→ `load_audio`（f32le 零拷貝、唯讀陣列，轉 torch 用 `audio.to_tensor`）→ `transcriber`（silero-vad 切段 → ≤120s 塊只在停頓處切 → 逐塊 mlx-whisper → 時間戳映射回原軸 → 濾字幕署名幻覺與重複迴圈）→ 寫 `segments.json`
  - 開說話者識別時 `diarizer.Diarization` 在 **spawn 子行程**跑 pyannote（MPS），**與 Whisper 並行**；進度經共享 `Value` 回傳，取消/失敗直接 terminate，結束後 torch/pyannote/MPS 記憶體隨行程歸還。Whisper 完成後 `assign_speakers` 逐字對齊並在句中換人處切句
  - VAD 語音覆蓋率 <20%（歌曲/音樂）時放棄 VAD 整段均分；`auto` 語言在第一塊偵測後鎖定
  - 說話者識別刻意吃**原始音訊**而非降噪檔，用 `exclusive_speaker_diarization`；`denoiser`/`diarizer` 在 pipeline 內延遲 import（torch 不用不載）
  - **閒置省資源**：`mlx_whisper` 在 `transcribe()` 內才 import（頂層 import 會讓閒置後端多 ~130MB）；轉錄任務數歸零時 `pipeline._release_models()` 清掉 mlx `ModelHolder` 與 MLX Metal 快取（否則常駐 1.5–3GB+）。下個任務重載模型約數秒
  - 進度權重 denoise 15 / transcribe 70 / diarize 25，未開啟的階段不佔比；進度 = 各階段完成度加權和（並行也正確）
  - 換模式時 transcriber 先清掉 `ModelHolder` 舊模型再載新的（否則兩個同時常駐）；`config.MLX_CACHE_LIMIT_MB` 限制 Metal 快取
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
- `AppContext`：全域 toast + 每 2s（活躍）/10s（閒置）輪詢 `/api/jobs?active=true`，分頁隱藏時暫停、回前景立即補抓（後端 access log 已過濾此輪詢）；任務離開 active 集合時 `jobsVersion++`，頁面把它放進 `useEffect` 依賴即自動刷新；建立/終止任務後呼叫 `refreshJobs()`
- `lib/api.ts` 一律用相對路徑 `/api`（Vite proxy 轉後端）；上傳用 XHR 取得進度
- 前端綁 `0.0.0.0`（區網可連），後端只綁 `127.0.0.1`——區網存取靠 Vite proxy，不要讓前端直連後端 Port

## 關鍵約束（改壞會很難查）

- **Port 單一來源**：根目錄 `.env` 的 `FRONTEND_PORT`/`BACKEND_PORT` 同時被 `manage.sh`、`vite.config.ts`、`config.py`（CORS）讀取。`manage.sh` 只認這兩個 key 與 `HF_TOKEN`，新增 `.env` 欄位要同步改它的解析規則
- **模型位置**：`config.py` 用 `os.environ["HF_HOME"] = <專案>/models`（刻意覆寫，非 setdefault），所有 HF 模型存在 `models/hub/`
- **mlx 模型名**：`whisper-small-mlx`、`whisper-large-v3-mlx` 帶 `-mlx` 後綴，`whisper-large-v3-turbo` 沒有（HF 實際 repo 名，寫錯會 404）
- **numpy 鎖版** `>=2.2.2,<2.5`：numba 上限 vs pyannote-metrics/scipy 下限
- **降噪**：用官方 Rust 執行檔 `backend/bin/deep-filter`（進版控）；DeepFilterNet 的 pip 套件已停更且會降級 numpy，**不要安裝**
- **pyannote 4.x**：pipeline 回傳 `DiarizeOutput`，用 `.exclusive_speaker_diarization`；跑在 MPS（實測 4.0.7 + torch 2.12 與 CPU 逐段相同、快約 13 倍），失敗自動退回 CPU；`embedding_batch_size=8` 壓峰值
- **pyannote 只能在子行程 import**：其相依 optuna 會把 ImportError 連同 traceback 永久存在模組裡，經 `f_back` 釘住 import 當下整條呼叫鏈的區域變數（音訊陣列、pipeline 永遠回收不了）；另外 `silero_vad` import 時會把 torch 全域執行緒設為 1，同 process 的 pyannote 會變單執行緒
- **不要加回** Whisper 的跨塊 `initial_prompt` 與 `hallucination_silence_threshold`：實測前者慢 2.6 倍、句子黏成 30 秒一段且會傳染錯字，後者會整句漏掉真實語音
- **MLX 快取上限**：`config.MLX_CACHE_LIMIT_MB`（256）不可拿掉，MLX 預設無上限，實測鯨魚模式 50 秒內衝破 11GB
- **HF_TOKEN** 在根目錄 `.env`（gitignore），pyannote gated model 用；帳號需在 HF 網站接受 `pyannote/speaker-diarization-community-1` 條款
- **中文輸出**：zh 結果一律過 OpenCC（segments 用 s2twp、words 用 s2t 保持字數對齊），不要移除
- **前後端對應**：轉錄模式 key（cheetah/dolphin/whale）與 job `stage` 名稱在 `config.MODE_MODELS` 與 `frontend/src/lib/format.ts`（`MODE_INFO`、`STAGE_LABEL`）兩邊都要改

## 慣例

- 註解與 UI 文案用繁體中文；錯誤訊息要可讀化（見 `downloader._readable_error`、`diarizer._get_pipeline`）
- 新增 API 後同步更新 `frontend/src/lib/api.ts` 與 `types.ts`
- 破壞性操作前端要過 `ConfirmDialog`
- **顏色**：只用 `index.css` 的 CSS 變數（經 `@theme inline` 變成 `bg-surface`、`text-sonar` 等 utility），元件內不寫色票；主題由 `useTheme` 切 `.dark` class，不跟隨系統
- **玻璃材質**：導覽/控制層用 `glass`，疊在內容上的彈窗/抽屜/toast 用 `glass-strong`，內容卡片用 `glass-card`（無 backdrop-filter，避免長列表卡頓）；`glass-rim` 需要定位元素。背景 `.ambient` 是靜態漸層 + 顆粒，**不要加常駐動畫**（玻璃的 backdrop-filter 會每幀重算，閒置也耗 GPU）
- **UI 形狀**：容器圓角只用 `rounded-panel`(24) → `rounded-row`(16) → `rounded-tile`(8)，每往內一層 `p-2` 就降一級（同心）；控制項一律 `rounded-full`，高度只用 32/40/48。狀態標籤用 `Badge`、選單用 `Menu`、帶欄位名的資訊用 `MetaLine`/`InfoItem`（都在 `components/ui.tsx`），不要自己手寫
- **長列表效能**：切主題時 `useTheme` 會加 `.theme-switching` 暫停全站 transition（否則逐字稿上千句會同時啟動數千個顏色動畫）；逐字稿列用 `offscreen-skip`（`content-visibility: auto`），其預估高度 = 單行句內容高，**改列的字級/行高時要同步改**，否則播放跟隨捲動會偏移
- 可拖曳歸檔的列表項目不要用 `motion.li`（framer-motion 會接管 `onDragStart` 破壞原生拖曳），進場動畫改用 CSS `rise-in`
