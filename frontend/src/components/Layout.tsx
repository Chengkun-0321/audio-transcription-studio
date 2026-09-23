/**
 * 共用外框：深海光暈背景 + 浮動玻璃 header（logo、導覽膠囊、任務抽屜、主題切換）＋ 頁面切換淡入。
 * header 高度維持 h-14（3.5rem）：MediaDetailPage 的 sticky 播放器以 top-14 / top-[5.5rem] 對齊它。
 * header 內層與 <main> 共用 PAGE_CONTAINER，logo 與頁面內容左右緣對齊。
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";
import { springBead } from "../lib/motion";
import { ThemeIcon } from "./sonar";
import { TaskDrawer } from "./TaskDrawer";
import { Toasts } from "./ui";

/** 全站內容寬度：header 與 main 共用，改這裡兩邊一起變 */
const PAGE_CONTAINER = "mx-auto w-full max-w-[1400px] px-4 md:px-6";

const nav = [
  {
    to: "/",
    label: "下載器",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: "/library",
    label: "媒體庫",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <rect x="3.5" y="8" width="17" height="12" rx="2.5" />
        <path d="M6 5h12M8.5 2.5h7" strokeLinecap="round" />
      </svg>
    ),
  },
];

/** 深海光暈：四顆緩慢漂移的色球 + 顆粒噪點（樣式在 index.css .ambient） */
function Ambient() {
  return (
    <div className="ambient" aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const reduced = useReducedMotion();
  // 媒體詳細頁歸在「媒體庫」底下
  const activeTo = /^\/(library|media)/.test(location.pathname) ? "/library" : "/";

  return (
    <div className="flex min-h-full flex-col">
      <Ambient />

      <header className="sticky top-0 z-20 h-14">
        <div aria-hidden className="scroll-edge pointer-events-none absolute inset-x-0 top-0 h-20" />
        <div className={`relative grid h-full grid-cols-[1fr_auto_1fr] items-center gap-2 ${PAGE_CONTAINER}`}>
          <Link
            to="/"
            className="press glass relative flex h-10 items-center gap-2 justify-self-start rounded-full px-2 sm:pr-4"
            aria-label="深海聲納首頁"
          >
            <svg viewBox="0 0 28 28" className="h-7 w-7 text-sonar drop-shadow-[0_0_6px_var(--sonar-soft)]" aria-hidden>
              <circle cx="14" cy="14" r="12" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
              <circle cx="14" cy="14" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
              <circle cx="14" cy="14" r="2.6" fill="currentColor" />
            </svg>
            <span className="hidden whitespace-nowrap font-display text-[15px] font-semibold sm:inline">深海聲納</span>
          </Link>

          <nav className="glass relative flex h-10 items-center rounded-full p-1" aria-label="主要導覽">
            {nav.map((n) => {
              const active = n.to === activeTo;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={active ? "page" : undefined}
                  className={`press relative flex h-8 items-center rounded-full px-3 text-sm transition-colors sm:px-4 ${
                    active ? "font-medium text-fg" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-bead"
                      className="bead absolute inset-0 rounded-full"
                      transition={springBead}
                    />
                  )}
                  <span className={`relative flex items-center gap-1.5 ${active ? "[&>svg]:text-sonar" : ""}`}>
                    {n.icon}
                    <span className="whitespace-nowrap">{n.label}</span>
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 justify-self-end">
            <TaskDrawer />
            <button
              onClick={(e) => toggle({ x: e.clientX, y: e.clientY })}
              className="press glass relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:text-fg"
              aria-label={dark ? "切換到水面（淺色）" : "切換到深海（深色）"}
              title={dark ? "切換到水面（淺色）" : "切換到深海（深色）"}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={dark ? "dark" : "light"}
                  className="flex"
                  initial={{ opacity: 0, y: dark ? -8 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: dark ? 8 : -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <ThemeIcon dark={dark} />
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </header>

      {/* 頁面載入：淡入＋些微上移 */}
      <motion.main
        key={location.pathname}
        className={`flex-1 py-5 md:py-8 ${PAGE_CONTAINER}`}
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
      >
        {children}
      </motion.main>

      <Toasts />
    </div>
  );
}
