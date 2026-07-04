/** 共用外框：sticky header（logo、導覽、任務抽屜、主題切換）＋ 頁面切換淡入動效。 */
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";
import { ThemeWaveIcon } from "./sonar";
import { TaskDrawer } from "./TaskDrawer";
import { Toasts } from "./ui";

const nav = [
  { to: "/", label: "下載器" },
  { to: "/library", label: "媒體庫" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const reduced = useReducedMotion();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-8">
            <NavLink to="/" className="flex items-center gap-2.5">
              <svg viewBox="0 0 28 28" className="h-7 w-7 text-sonar" aria-hidden>
                <circle cx="14" cy="14" r="12" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
                <circle cx="14" cy="14" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
                <circle cx="14" cy="14" r="2.6" fill="currentColor" />
              </svg>
              <span className="font-display text-base font-semibold tracking-wide">深海聲納</span>
            </NavLink>
            <nav className="flex items-center gap-1">
              {nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-sonar-soft font-medium text-sonar"
                        : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <TaskDrawer />
            <button
              onClick={toggle}
              className="rounded-lg border border-line p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              title={dark ? "切換到水面（淺色）" : "切換到深海（深色）"}
            >
              <ThemeWaveIcon dark={dark} />
            </button>
          </div>
        </div>
      </header>

      {/* 頁面載入：淡入＋些微上移，200ms 內完成（規格 §6） */}
      <motion.main
        key={location.pathname}
        className="mx-auto w-full max-w-6xl flex-1 px-5 py-8"
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {children}
      </motion.main>

      <Toasts />
    </div>
  );
}
