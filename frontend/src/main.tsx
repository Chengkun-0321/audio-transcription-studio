/** React 進入點：掛載 App、載入全域樣式與自架字體。 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// 字體 self-host（@fontsource），離線也能用
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
