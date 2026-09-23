/** Vite 設定：前後端 Port 統一讀取專案根目錄 .env。 */
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

function parsePort(raw: string | undefined, fallback: number, name: string): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} 必須是 1–65535 的整數，目前值：${raw}`);
  }
  return value;
}

export default defineConfig(({ mode }) => {
  // 用本檔位置定位專案根目錄，不依賴執行時的 cwd
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const frontendPort = parsePort(
    process.env.FRONTEND_PORT ?? env.FRONTEND_PORT,
    3000,
    "FRONTEND_PORT",
  );
  const backendPort = parsePort(
    process.env.BACKEND_PORT ?? env.BACKEND_PORT,
    8000,
    "BACKEND_PORT",
  );

  // dev（manage.sh dev）與 preview（manage.sh start 正式模式）共用：後端只綁 127.0.0.1，一律經 proxy
  const proxy = { "/api": `http://127.0.0.1:${backendPort}` };

  return {
    plugins: [react(), tailwindcss()],
    server: { port: frontendPort, strictPort: true, proxy },
    preview: { port: frontendPort, strictPort: true, proxy },
  };
});
