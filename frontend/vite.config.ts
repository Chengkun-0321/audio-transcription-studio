/** Vite 設定：React + Tailwind 4（官方 vite plugin），dev server 固定 3000。 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      // 前端不寫死後端網址，一律走 dev proxy
      "/api": "http://127.0.0.1:8000",
    },
  },
});
