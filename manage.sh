#!/usr/bin/env bash
# 一鍵開關（規格 §7）：前後端各一個 process，pid file 追蹤，不常駐、不開機自啟
#
# 用法: ./manage.sh {start|stop|status|restart|logs}
#   start   啟動後端(uvicorn:8000) + 前端(vite:3000)，pid 記在 .run/
#   stop    kill 兩個 process，完全不佔資源
#   status  顯示兩個 process 是否存活
#   restart stop + start（後端程式碼變更後需要，前端 Vite 有 HMR 通常不用）
#   logs    顯示兩邊最後 40 行日誌
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$DIR/.run"
mkdir -p "$RUN_DIR"

BACKEND_PORT=8000
FRONTEND_PORT=3000

# process 是否存活：pid file 存在且該 pid 仍在跑
_alive() {
  [[ -f "$RUN_DIR/$1.pid" ]] && kill -0 "$(cat "$RUN_DIR/$1.pid")" 2>/dev/null
}

start() {
  if _alive backend || _alive frontend; then
    echo "已經在跑了，執行 ./manage.sh status 查看"
    exit 0
  fi

  # 後端：venv 的 uvicorn（直接執行，pid 即真正的伺服器行程）
  cd "$DIR/backend"
  nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
    > "$RUN_DIR/backend.log" 2>&1 &
  echo $! > "$RUN_DIR/backend.pid"

  # 前端：用 nvm 指定的 Node 22 直接跑 vite（不經 npm wrapper，方便乾淨關閉）
  cd "$DIR/frontend"
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null
  nohup node node_modules/vite/bin/vite.js --port "$FRONTEND_PORT" \
    > "$RUN_DIR/frontend.log" 2>&1 &
  echo $! > "$RUN_DIR/frontend.pid"

  echo "已啟動 → http://localhost:$FRONTEND_PORT"
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
}

status() {
  for name in backend frontend; do
    if _alive "$name"; then
      echo "$name 運行中 (pid $(cat "$RUN_DIR/$name.pid"))"
    else
      echo "$name 未運行"
    fi
  done
}

logs() {
  tail -n 40 "$RUN_DIR/backend.log" "$RUN_DIR/frontend.log" 2>/dev/null || echo "尚無日誌"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  restart) stop; sleep 1; start ;;
  logs) logs ;;
  *) echo "用法: ./manage.sh {start|stop|status|restart|logs}" ;;
esac
