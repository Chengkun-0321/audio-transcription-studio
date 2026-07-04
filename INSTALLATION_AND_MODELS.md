# 安裝、模型與說話者識別設定

本文件整理新電腦從 GitHub 取得本專案後的安裝方式、模型下載時機、儲存位置，以及首次啟用說話者識別的步驟。

## 1. 執行環境

本專案使用 MLX 與專用的 ARM64 DeepFilterNet 執行檔，因此完整功能需要：

- Apple Silicon Mac（M1、M2、M3、M4 或後續 ARM64 機型）
- 可使用 Metal 的 macOS 桌面環境
- Homebrew
- Git
- Python 3.12
- FFmpeg 與 FFprobe
- nvm（`manage.sh` 預期位於 `~/.nvm/nvm.sh`）
- Node.js 22
- 網路連線：安裝套件、首次下載模型及使用 YouTube 下載時需要
- 至少約 10 GB 可用空間；上傳或下載的媒體檔另計

先依 [Homebrew 官方說明](https://brew.sh/) 安裝 Homebrew，再安裝系統工具：

```bash
xcode-select --install
brew install git python@3.12 ffmpeg
```

請另外安裝標準 nvm，並確認以下檔案存在：

```text
~/.nvm/nvm.sh
```

## 2. Clone 後安裝

```bash
git clone <GitHub 專案網址>
cd 本地語音轉譯
cp .env.example .env

python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/python -m pip install -r backend/requirements.txt

source ~/.nvm/nvm.sh
cd frontend
nvm install 22
nvm use 22
npm ci
cd ..
```

不需要安裝 Docker 或資料庫。DeepFilterNet ARM64 執行檔已包含在 `backend/bin/deep-filter`。

前後端 Port 只需在根目錄 `.env` 設定：

```dotenv
FRONTEND_PORT=3000
BACKEND_PORT=8000
HF_TOKEN=
```

修改後執行 `./manage.sh restart`；啟動腳本、Vite proxy 與後端 CORS 會使用相同設定。

## 3. 專案資源位置

本專案自行產生及下載的持久資料主要放在專案內：

| 資源 | 位置 |
|---|---|
| Hugging Face 模型 | `models/hub/` |
| 使用者媒體與轉錄結果 | `data/` |
| Python 套件 | `backend/.venv/` |
| 前端套件 | `frontend/node_modules/` |
| DeepFilterNet | `backend/bin/deep-filter` |
| PID 與日誌 | `.run/` |

Python、Node.js、nvm、FFmpeg、macOS、Metal 及執行期間的系統暫存檔不屬於專案資料夾。

### 模型路徑注意事項

目前 `backend/app/config.py` 已強制使用專案內的模型目錄：

```python
os.environ["HF_HOME"] = str(MODELS_DIR)
```

因此即使電腦已設定其他 `HF_HOME`，本專案的 Whisper 與 Pyannote 模型仍固定放在本專案 `models/`，不會使用其他專案的模型快取。兩種設定的差異如下：

- `os.environ.setdefault(...)`：只有外部未設定 `HF_HOME` 時才使用專案路徑。
- `os.environ[...] = ...`：無條件使用專案路徑，符合本專案的獨立管理需求。

## 4. 模型下載時機

Git clone 不會下載 AI 模型，模型會在功能第一次使用時按需下載：

| 功能 | 模型 | 下載時機 |
|---|---|---|
| 獵豹 | `mlx-community/whisper-small-mlx` | 第一次用獵豹轉譯 |
| 海豚 | `mlx-community/whisper-large-v3-turbo` | 第一次用海豚轉譯 |
| 鯨魚 | `mlx-community/whisper-large-v3-mlx` | 第一次用鯨魚轉譯 |
| 說話者識別 | `pyannote/speaker-diarization-community-1` 及相依模型 | 第一次勾選說話者識別 |

下載完成後會重用本機模型；正常情況下不會再次下載。`HF_TOKEN` 只授權 Pyannote gated model，不會安裝 Python、Node.js、FFmpeg，也不會預先下載全部模型。

## 5. 首次啟用說話者識別

### 步驟 1：建立 Hugging Face 帳號

前往 [Hugging Face](https://huggingface.co/) 註冊或登入。

### 步驟 2：接受模型使用條款

登入後開啟 [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1)，閱讀條款並按下頁面上的同意／存取按鈕。未完成此步驟，即使 Token 正確也會收到 403 或 gated model 錯誤。

### 步驟 3：建立 Access Token

前往 [Hugging Face Access Tokens](https://huggingface.co/settings/tokens) 建立具有模型讀取權限的 Token，複製以 `hf_` 開頭的完整值。

### 步驟 4：建立專案環境檔

編輯專案根目錄 `.env`，填入 Token：

```dotenv
HF_TOKEN=hf_你的實際Token
```

再限制檔案權限：

```bash
chmod 600 .env
```

根目錄 `.env` 已列入 `.gitignore`，不得提交或分享 Token。

### 步驟 5：重新啟動服務

環境變數在後端啟動時讀取；建立或修改 `.env` 後需重新啟動：

```bash
./manage.sh restart
```

### 步驟 6：首次執行

1. 開啟 `http://localhost:3000`。
2. 上傳或下載一個媒體檔。
3. 建立轉錄任務並開啟「說話者識別」。
4. 保持網路連線，等待 Pyannote 模型首次下載及 CPU 推理完成。
5. 模型下載後保存在 `models/hub/`，後續可離線執行說話者識別。

說話者識別強制使用 CPU；長音檔會比一般轉譯多花明顯時間。

## 6. 啟動與檢查

```bash
./manage.sh start
./manage.sh status
```

瀏覽器開啟：

```text
http://localhost:3000
```

若啟動或模型下載失敗：

```bash
./manage.sh logs
```

常見原因包括：未接受 Pyannote 條款、Token 錯誤、首次下載時無網路、磁碟空間不足、FFmpeg 未安裝，或執行環境無法使用 Metal。
