#!/usr/bin/env bash
# 一鍵開關（規格 §7）：前後端各一個 process，pid file 追蹤，不常駐、不開機自啟
#
# 用法: ./manage.sh {start|dev|stop|status|restart|logs}
#   start   正式模式（日常使用）：前端打包後由 vite preview 提供，無檔案監看、載入 React 正式版，閒置最省
#           原始碼有變動才重新打包，所以改前端後 restart 即生效
#   dev     開發模式：前端跑 Vite dev server（HMR，存檔即時更新）
#   stop    kill 兩個 process，完全不佔資源
#   status  顯示兩個 process 是否存活與前端模式
#   restart stop + 以上次的模式重新啟動（後端程式碼變更後需要）
#   logs    顯示兩邊最後 40 行日誌
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$DIR/.run"
mkdir -p "$RUN_DIR"

# 單一設定來源：只解析兩個 Port 欄位，不把 .env 當成 Shell 腳本執行。
BACKEND_PORT=8000
FRONTEND_PORT=3000
if [[ -f "$DIR/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*(BACKEND_PORT|FRONTEND_PORT)[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$ ]]; then
      printf -v "${BASH_REMATCH[1]}" '%s' "${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^[[:space:]]*HF_TOKEN[[:space:]]*= ]]; then
      continue  # Token 由後端讀取，啟動腳本不得展開或輸出祕密。
    else
      echo "略過不認識的 .env 設定：$line" >&2
    fi
  done < "$DIR/.env"
fi

_validate_port() {
  local name="$1" value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "$name 必須是 1–65535 的整數，目前值：$value" >&2
    exit 1
  fi
}

_validate_port BACKEND_PORT "$BACKEND_PORT"
_validate_port FRONTEND_PORT "$FRONTEND_PORT"

# process 是否存活：pid file 存在且該 pid 仍在跑
_alive() {
  [[ -f "$RUN_DIR/$1.pid" ]] && kill -0 "$(cat "$RUN_DIR/$1.pid")" 2>/dev/null
}

# 載入 nvm 指定的 Node 22 並切到 frontend/
_use_node() {
  cd "$DIR/frontend"
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null
}

# 需要重新打包：dist 不存在，或任何前端原始檔比它新（.env 的 Port 在 preview 啟動時才讀，不影響打包）
_needs_build() {
  [[ ! -f dist/index.html ]] ||
    [[ -n "$(find src index.html vite.config.ts tsconfig.json package-lock.json \
      -newer dist/index.html -print -quit 2>/dev/null)" ]]
}

_mode_label() {
  [[ "$1" == dev ]] && echo "開發模式" || echo "正式模式"
}

# $1: prod（預設）| dev
start() {
  local mode="${1:-prod}"
  if _alive backend || _alive frontend; then
    echo "已經在跑了，執行 ./manage.sh status 查看"
    exit 0
  fi

  # 先打包：失敗就不啟動任何 process
  _use_node
  if [[ "$mode" == prod ]] && _needs_build; then
    echo "前端有變動，重新打包…"
    if ! node node_modules/vite/bin/vite.js build --logLevel warn; then
      echo "前端打包失敗，未啟動任何服務" >&2
      exit 1
    fi
  fi

  # 後端：venv 的 uvicorn（直接執行，pid 即真正的伺服器行程）
  cd "$DIR/backend"
  nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
    > "$RUN_DIR/backend.log" 2>&1 &
  echo $! > "$RUN_DIR/backend.pid"

  # 前端：直接跑 vite（不經 npm wrapper，方便乾淨關閉）
  cd "$DIR/frontend"
  if [[ "$mode" == dev ]]; then
    nohup node node_modules/vite/bin/vite.js --host 0.0.0.0 --port "$FRONTEND_PORT" \
      > "$RUN_DIR/frontend.log" 2>&1 &
  else
    nohup node node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port "$FRONTEND_PORT" \
      > "$RUN_DIR/frontend.log" 2>&1 &
  fi
  echo $! > "$RUN_DIR/frontend.pid"
  echo "$mode" > "$RUN_DIR/frontend.mode"

  echo "已啟動（$(_mode_label "$mode")）→ http://localhost:$FRONTEND_PORT"
  echo "（日誌在 .run/backend.log 與 .run/frontend.log）"
}

stop() {
  for name in backend frontend; do
    if _alive "$name"; then
      kill "$(cat "$RUN_DIR/$name.pid")"
      echo "已停止 $name"
    fi
    rm -f "$RUN_DIR/$name.pid"
  done
  rm -f "$RUN_DIR/frontend.mode"
}

status() {
  for name in backend frontend; do
    if _alive "$name"; then
      local extra=""
      if [[ "$name" == frontend && -f "$RUN_DIR/frontend.mode" ]]; then
        extra="，$(_mode_label "$(cat "$RUN_DIR/frontend.mode")")"
      fi
      echo "$name 運行中 (pid $(cat "$RUN_DIR/$name.pid")$extra)"
    else
      echo "$name 未運行"
    fi
  done
}

# 沿用上次的前端模式；舊版啟動（沒有 mode 檔）一律回到正式模式
restart() {
  local mode
  mode="$(cat "$RUN_DIR/frontend.mode" 2>/dev/null || echo prod)"
  stop
  sleep 1
  start "$mode"
}

logs() {
  tail -n 40 "$RUN_DIR/backend.log" "$RUN_DIR/frontend.log" 2>/dev/null || echo "尚無日誌"
}

case "${1:-}" in
  start) start prod ;;
  dev) start dev ;;
  stop) stop ;;
  status) status ;;
  restart) restart ;;
  logs) logs ;;
  *) echo "用法: ./manage.sh {start|dev|stop|status|restart|logs}" ;;
esac
