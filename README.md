# 深海聲納 — 本地語音轉錄與媒體下載工具

單人本地工具：YouTube 下載 + MLX Whisper 轉錄（Apple Silicon Metal 加速）+ 說話者識別 + AI 降噪 + TXT/SRT/DOCX 匯出。無帳號、無資料庫、無 Docker，不用時完全關閉。

完整實作說明（技術棧、模型、轉譯與降噪流程）見 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 使用

```bash
./manage.sh start    # 啟動 → http://localhost:3000
./manage.sh stop     # 完全關閉，不佔資源
./manage.sh status   # 查看狀態
./manage.sh logs     # 看日誌
```

## 功能

| 功能 | 說明 |
|---|---|
| YouTube 下載 | 首頁貼網址，MP4/MP3，背景下載＋進度條 |
| 上傳 | 拖放多檔（MP3/MP4/M4A/MOV/AAC/WAV/OGG/OPUS/MPEG/WMA/WMV） |
| 轉錄模式 | 獵豹（whisper-small，快）／海豚（large-v3-turbo，平衡）／鯨魚（large-v3，準） |
| 語言 | 自動偵測／繁中／English／其他 18 種；中文結果自動轉繁體（OpenCC s2twp） |
| 說話者識別 | pyannote community-1，CPU 運算（預設關，長音檔慢） |
| 音訊修復 | DeepFilterNet 官方執行檔（backend/bin/deep-filter） |
| 站內播放 | 影片/音訊直接播放，逐字稿點時間戳跳轉、播放跟隨高亮 |
| 檔案管理 | 資料夾、拖曳歸檔、單檔/批次移動、搜尋、排序、批次刪除、改名 |
| 任務管理 | 全部背景執行、真實進度條、可隨時終止 |
| 時間戳開關 | 逐字稿顯示與匯出可切換含/不含時間戳 |
| 匯出 | TXT／SRT／DOCX |

## 架構

- `backend/`：FastAPI + Python 3.12（`.venv`）。任務用 BackgroundTasks，狀態寫回 JSON。
- `frontend/`：Vite 7 + React 19 + Tailwind 4（Node 22，`.nvmrc`）。
- `data/`：檔案系統即資料庫——`library/<資料夾>/<media-id>/`（source.* + meta.json + jobs/），`inbox/` 為未分類。備份 = 複製 data/。
- `models/`：所有 AI 模型統一放在專案內（約 4.9GB，首次使用自動下載，之後離線可用，不進版控）。
- `backend/.env`：`HF_TOKEN`（pyannote gated model 用，不進版控）。

## 已知限制

- Whisper 對長靜音的幻覺已用 silero-vad 切除靜音段緩解。
- 說話者識別為 CPU-bound（pyannote 無 MLX 版），一小時音檔約 10–20 分鐘。
- 鯨魚模式在 16GB 機型與其他大型程式並用時可能有記憶體壓力。
- yt-dlp 與 YouTube ToS 有灰色地帶，僅供個人本機使用。
