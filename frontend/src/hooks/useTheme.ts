import { useCallback, useEffect, useState } from "react";

/**
 * 手動雙主題：只由使用者點擊切換，不跟隨 macOS（規格 §6）。
 * 以 <html> 的 .dark class 切換（對應 index.css 的 @custom-variant dark），
 * 選擇存 localStorage，預設深色（深海）。
 */
export function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") !== "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return { dark, toggle };
}
