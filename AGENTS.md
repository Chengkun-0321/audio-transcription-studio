# Repository Guidelines

## 專案結構與模組分工

這是單人使用的本機語音轉錄與媒體下載工具。`backend/app/` 放 FastAPI 入口 `main.py`、API 路由 `routers/`、檔案儲存層 `storage.py` 和處理流程 `services/`。`frontend/src/` 放 React 頁面、元件、Context、Hooks，以及 `lib/` 中的 API 與型別。使用者媒體和任務 JSON 存於 `data/inbox/`、`data/library/`；下載的 AI 模型存於 `models/`。這些執行期目錄都不進版控。功能與處理流程分別見 `README.md`、`詳細實作說明.md`。

## 建置、驗證與開發指令

- `cp .env.example .env`：建立本機 Port 與選用的 Hugging Face Token 設定。
- `./manage.sh start`：以正式模式啟動前後端（前端有變動才 `vite build`，再由 `vite preview` 提供），開啟 `http://localhost:3000`。`./manage.sh dev` 改用 Vite dev server（HMR）。`stop`、`restart`（沿用上次模式）、`status`、`logs` 分別用於停止、重啟、查狀態與看日誌。後端沒有自動重載，修改後須執行 `restart`；正式模式下前端修改也須 `restart`。
- `cd frontend && npm ci && npm run build`：依鎖定版本安裝套件，執行 TypeScript 檢查並建置 Vite。Node 版本依 `frontend/.nvmrc` 使用 22。
- `cd backend && .venv/bin/python -c "from app.main import app"`：驗證後端可匯入；必須在 `backend/` 目錄執行。

## 程式風格與命名

沿用現有格式：Python 縮排四格、名稱用 `snake_case`；TypeScript 縮排兩格並保留分號，函式用 `camelCase`、React 元件用 `PascalCase`。介面文字與說明性註解使用繁體中文。新增 API 時，同步更新 `frontend/src/lib/api.ts` 與 `types.ts`。樣式優先使用共用 CSS 變數和 UI 元件，不在元件內新增硬編碼色值。

## 測試準則

目前沒有專案測試套件、測試檔命名慣例、linter 或覆蓋率門檻。每次修改至少執行前端 `npm run build` 和上述後端匯入檢查，再手動操作受影響功能。若新增自動化測試，將測試放在對應前後端程式附近，並在同一次變更中寫明執行方式。

## Commit 與 Pull Request

近期提交採 `type(scope): 簡短描述`，例如 `feat(frontend): ...`、`fix(responsive): ...`、`docs(claude): ...`。每個 commit 聚焦一項變更。Pull Request 應說明行為變化、驗證指令及相關 issue；介面修改附上截圖。

## 安全與設定

`HF_TOKEN` 只放在已忽略的根目錄 `.env`，不要提交 Token、使用者媒體或下載的模型。前端 API 請求保持相對路徑 `/api`，由 Vite proxy 轉送；後端維持只綁定本機介面。修改 `storage.py` 時，維持任務 JSON 為狀態來源，並保留原子寫入。

為了閒置時少佔資源：`mlx_whisper` 維持在 `transcribe()` 內延遲 import；轉錄任務全部結束時由 `pipeline._release_models()` 釋放 Whisper、pyannote 模型與 MLX 快取；前端輪詢在分頁隱藏時暫停；背景 `.ambient` 維持靜態，不加常駐動畫。切主題時 `useTheme` 以 `.theme-switching` 暫停全站 transition；逐字稿列的 `offscreen-skip` 預估高度需與列的字級、行高同步。
