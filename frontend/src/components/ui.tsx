/** 通用 UI 元件（液態玻璃）：按鈕、圖示鈕、分段控制、下拉選單、開關、勾選、進度條、彈窗、確認框、空狀態、Toast */
import { AnimatePresence, motion } from "framer-motion";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { useApp } from "../context/AppContext";
import { exitFast, spring, springBead } from "../lib/motion";
import { CheckDraw } from "./sonar";

type ButtonVariant = "primary" | "glass" | "glass-danger" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

// 玻璃按鈕的 hover 用 ::after 疊一層淡色（::before 已被折射邊框佔用）
const GLASS_HOVER = "after:absolute after:inset-0 after:rounded-[inherit] after:bg-fg/0 after:transition-colors";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-gel",
  glass: `glass text-fg ${GLASS_HOVER} hover:after:bg-fg/[0.06]`,
  "glass-danger": `glass text-fg-muted ${GLASS_HOVER} hover:text-danger hover:after:bg-danger/[0.08]`,
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "bg-danger text-ink shadow-[0_8px_22px_-8px_var(--danger)] hover:brightness-110",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-xs",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-[15px]",
};

/** 按鈕：primary = 凝膠主行動、glass = 次要、ghost = 低調、danger = 破壞性 */
export function Button({
  variant = "glass",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={`press relative inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    />
  );
}

/** 圓形 icon-only 按鈕：label 同時作為 aria-label 與 tooltip。tone 決定 hover 色。 */
export function IconButton({
  label,
  tone = "default",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: "default" | "accent" | "danger";
  size?: "sm" | "md";
}) {
  const toneClass = tone === "danger" ? "hover:text-danger" : tone === "accent" ? "hover:text-sonar" : "hover:text-fg";
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={`press inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:bg-fg/[0.07] disabled:cursor-not-allowed disabled:opacity-40 ${
        size === "sm" ? "h-7 w-7" : "h-9 w-9"
      } ${toneClass} ${className}`}
    />
  );
}

/** 分段控制：選中的「水珠」以彈簧在選項間滑動（iOS segmented control）。 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className = "",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`field inline-flex rounded-full ${size === "sm" ? "p-0.5" : "p-1"} ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`press relative flex cursor-pointer items-center gap-1.5 rounded-full transition-colors ${
              size === "sm" ? "h-6 px-2.5 text-xs" : "h-8 px-4 text-sm"
            } ${active ? "font-medium text-fg" : "text-fg-muted hover:text-fg"}`}
          >
            {active && (
              <motion.span layoutId={`seg-${id}`} className="bead absolute inset-0 rounded-full" transition={springBead} />
            )}
            <span className="relative flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 原生 select 換上玻璃外觀（保留原生鍵盤操作與無障礙）。 */
export function Select({
  className = "",
  size = "md",
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <div className={`relative ${className}`}>
      <select
        {...props}
        className={`field w-full cursor-pointer appearance-none rounded-full text-fg [&>option]:bg-[var(--glass-solid)] ${
          sm ? "h-7 pl-3 pr-7 text-xs" : "h-10 pl-4 pr-9 text-sm"
        }`}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted ${
          sm ? "right-2.5 h-3.5 w-3.5" : "right-3.5 h-4 w-4"
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * iOS 開關。透明的原生 checkbox 覆蓋整顆開關：外層 <label> 點擊、空白鍵切換、螢幕閱讀器都走原生行為；
 * 聚焦環畫在軌道上（input 本身不可見）。
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** 外層沒有 <label> 包住時必填 */
  label?: string;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex h-6 w-10 shrink-0 ${className}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={`absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)] transition-colors duration-300 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sonar peer-disabled:opacity-40 ${
          checked ? "bg-sonar" : "bg-fg/15"
        }`}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25),0_3px_8px_-2px_rgba(0,0,0,0.2)] transition-transform duration-500 ease-[var(--ease-spring)] ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </span>
  );
}

/** 圓形勾選（列表多選）：與 Switch 相同的透明原生 input 手法。 */
export function Checkbox({
  checked,
  onChange,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex h-5 w-5 shrink-0 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer appearance-none rounded-full opacity-0"
      />
      <span
        aria-hidden
        className={`flex h-5 w-5 items-center justify-center rounded-full transition-[background-color,box-shadow,transform] duration-300 ease-[var(--ease-spring)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sonar peer-active:scale-90 ${
          checked
            ? "bg-sonar text-ink shadow-[0_2px_8px_-2px_var(--sonar)]"
            : "bg-fg/[0.03] shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--fg)_28%,transparent)]"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3.2}>
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </span>
  );
}

/** 進度條：processing=true 琥珀色＋流光（進行中），否則聲納綠（完成）。用 transform 推進，不重排版面。 */
export function ProgressBar({
  value,
  processing = false,
  className = "",
}: {
  value: number;
  processing?: boolean;
  className?: string;
}) {
  const pct = Math.max(2, Math.min(100, value));
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-fg/10 shadow-[inset_0_1px_1px_rgba(0,0,0,0.12)] ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full w-full rounded-full transition-transform duration-700 ease-[var(--ease-fluid)] ${
          processing ? "shimmer bg-amber" : "bg-sonar"
        }`}
        style={{ transform: `translateX(${pct - 100}%)` }}
      />
    </div>
  );
}

/** 彈窗：Esc 或點背景關閉；開啟時聚焦面板、關閉後還原焦點。wide=true 加寬（上傳彈窗用）。 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose 常是父層的 inline 函式；用 ref 讓 effect 只跟 open 走，避免每次重繪都搶焦點
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.2 } }}
          exit={{ opacity: 0, transition: exitFast }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={`glass-strong relative flex max-h-[88vh] w-full ${wide ? "max-w-2xl" : "max-w-lg"} flex-col overflow-hidden rounded-[28px] outline-none`}
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: exitFast }}
          >
            <div className="flex items-center justify-between px-6 pb-2 pt-5">
              <h2 id={titleId} className="font-display text-lg font-semibold">
                {title}
              </h2>
              <IconButton label="關閉" onClick={onClose} className="-mr-2">
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </IconButton>
            </div>
            <div className="overflow-y-auto px-6 pb-6 pt-2">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 破壞性操作確認框（刪除媒體/資料夾等），danger=true 紅色確認鈕。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "刪除",
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm leading-relaxed text-fg-muted">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="glass" onClick={onCancel}>
          取消
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/** 空狀態：靜態波形插圖 + 標題 + 提示 + 可選行動按鈕。 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <svg viewBox="0 0 64 24" className="h-8 w-20 text-fg/15" aria-hidden>
        {[6, 14, 9, 18, 7, 16, 11, 5, 13, 8].map((h, i) => (
          <rect key={i} x={i * 6.4 + 1} y={(24 - h) / 2} width={3} height={h} rx={1.5} fill="currentColor" />
        ))}
      </svg>
      <p className="font-display text-base text-fg-muted">{title}</p>
      {hint && <p className="max-w-sm text-sm text-fg-muted/70">{hint}</p>}
      {action}
    </div>
  );
}

/** 全域 toast 顯示區（底部置中），點擊即關閉。狀態在 AppContext。 */
export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            onClick={() => dismissToast(t.id)}
            className={`glass-strong pointer-events-auto relative flex cursor-pointer items-center gap-2.5 rounded-full py-2.5 pl-4 pr-5 text-left text-sm ${
              t.kind === "error" ? "text-danger" : "text-fg"
            }`}
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
            exit={{ opacity: 0, scale: 0.94, transition: exitFast }}
          >
            {t.kind === "success" && <CheckDraw className="h-4 w-4 shrink-0" />}
            {t.kind === "error" && (
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
            )}
            <span className="leading-snug">{t.message}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
