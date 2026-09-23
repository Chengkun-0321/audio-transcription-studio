import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * 手動雙主題：只由使用者點擊切換，不跟隨 macOS。
 * 以 <html> 的 .dark class 切換（對應 index.css 的 @custom-variant dark），
 * 選擇存 localStorage，預設深色（深海）。
 * 支援 View Transitions 的瀏覽器會從點擊位置以圓形擴散切換主題。
 */
export function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") !== "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const toggle = useCallback((origin?: { x: number; y: number }) => {
    const apply = () => {
      const root = document.documentElement;
      // 切換瞬間停用全站 transition：逐字稿上千句的 transition-colors 會同時啟動數千個顏色動畫而卡頓
      root.classList.add("theme-switching");
      const next = !root.classList.contains("dark");
      root.classList.toggle("dark", next);
      flushSync(() => setDark(next));
      // 強制在停用狀態下完成樣式重算；之後恢復 transition 時顏色已是新值，不會再觸發動畫
      void document.body.offsetHeight;
      root.classList.remove("theme-switching");
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced || !origin) {
      apply();
      return;
    }
    const { x, y } = origin;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  }, []);

  return { dark, toggle };
}
