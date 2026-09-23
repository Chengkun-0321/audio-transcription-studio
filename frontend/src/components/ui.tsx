/**
 * 通用 UI 元件（液態玻璃）：按鈕、圖示鈕、分段控制、下拉選單、開關、勾選、狀態標籤、
 * 資訊欄位、進度條、浮動面板／選單、彈窗、確認框、空狀態、Toast。
 * 形狀規則見 index.css 開頭：控制項膠囊＋高度 32/40/48，容器圓角 24/16/8 同心。
 */
import { AnimatePresence, motion } from "framer-motion";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context/AppContext";
import { exitFast, spring, springBead } from "../lib/motion";
import { CheckDraw } from "./sonar";

type ButtonVariant = "primary" | "glass" | "glass-danger" | "ghost" | "danger";
type ControlSize = "sm" | "md" | "lg";

// 玻璃按鈕的 hover 用 ::after 疊一層淡色（::before 已被折射邊框佔用）
const GLASS_HOVER = "after:absolute after:inset-0 after:rounded-[inherit] after:bg-fg/0 after:transition-colors";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-gel",
  glass: `glass text-fg ${GLASS_HOVER} hover:after:bg-fg/[0.06]`,
  "glass-danger": `glass text-fg-muted ${GLASS_HOVER} hover:text-danger hover:after:bg-danger/[0.08]`,
  ghost: "text-fg-muted hover:bg-fg/[0.07] hover:text-fg",
  danger: "bg-danger text-ink shadow-[0_8px_22px_-8px_var(--danger)] hover:brightness-110",
};

/** 控制項三級高度：sm 32 / md 40 / lg 48（全站只用這三種） */
const BUTTON_SIZE: Record<ControlSize, string> = {
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
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ControlSize }) {
  return (
    <button
      type="button"
      {...props}
      className={`press relative inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    />
  );
}

/**
 * 圓形 icon-only 按鈕：label 同時作為 aria-label 與 tooltip。
 * tone 決定 hover 色；variant="glass" 為浮在背景上的玻璃圓鈕（標題列的 ✎、⋯）。
 */
export function IconButton({
  label,
  tone = "default",
  size = "md",
  variant = "plain",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: "default" | "accent" | "danger";
  size?: "sm" | "md";
  variant?: "plain" | "glass";
}) {
  const toneClass = tone === "danger" ? "hover:text-danger" : tone === "accent" ? "hover:text-sonar" : "hover:text-fg";
  const variantClass = variant === "glass" ? `glass relative ${GLASS_HOVER} hover:after:bg-fg/[0.06]` : "hover:bg-fg/[0.07]";
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={`press inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted disabled:cursor-not-allowed disabled:opacity-40 ${
        size === "sm" ? "h-8 w-8" : "h-10 w-10"
      } ${variantClass} ${toneClass} ${className}`}
    />
  );
}

/** ⋯ 圖示（更多操作） */
export function MoreIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}

/** 分段控制：選中的「水珠」以彈簧在選項間滑動（iOS segmented control）。外框高度 sm 32 / md 40。 */
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
              size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-4 text-sm"
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

/**
 * 原生 select 換上玻璃外觀（保留原生鍵盤操作與無障礙）。
 * variant="bare" 無外框、字級與資訊欄位的值一致，用在 InfoItem 內（例：資料夾）。
 */
export function Select({
  className = "",
  size = "md",
  variant = "field",
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "sm" | "md"; variant?: "field" | "bare" }) {
  const sm = size === "sm";
  const bare = variant === "bare";
  const selectClass = bare
    ? "h-5 bg-transparent pr-5 text-sm font-medium"
    : `field rounded-full ${sm ? "h-8 pl-3.5 pr-8 text-xs" : "h-10 pl-4 pr-9 text-sm"}`;
  return (
    <div className={`relative ${className}`}>
      <select
        {...props}
        className={`w-full cursor-pointer appearance-none truncate text-fg [&>option]:bg-[var(--glass-solid)] ${selectClass}`}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted ${
          bare ? "right-0 h-4 w-4" : sm ? "right-3 h-3.5 w-3.5" : "right-3.5 h-4 w-4"
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

type BadgeTone = "neutral" | "sonar" | "amber" | "danger";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-fg/[0.06] text-fg-muted",
  sonar: "bg-sonar-soft text-sonar",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
};

/** 狀態標籤：固定 24px 高的膠囊（已轉錄、未轉錄、失敗、計數…），全站唯一的標籤樣式。 */
export function Badge({
  tone = "neutral",
  className = "",
  children,
  ...props
}: { tone?: BadgeTone; className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLSpanElement>, "className">) {
  return (
    <span
      {...props}
      className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

type MetaItem = { label: string; value: ReactNode; mono?: boolean; /** 手機寬度隱藏（次要資訊） */ optional?: boolean };

/**
 * 內嵌標籤的資訊列：「時長 1:22:17 · 加入 9月3日 14:25 · 來源 本機上傳」。
 * 每個值前面都有欄位名，傳入 false/null 的項目會略過。
 * 手機寬度換行時不畫分隔點（避免點落在行首），改以間距分隔；optional 項目在手機隱藏。
 */
export function MetaLine({
  items,
  className = "",
}: {
  items: (MetaItem | false | null | undefined)[];
  className?: string;
}) {
  const list = items.filter((it): it is MetaItem => !!it);
  return (
    <p className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs sm:gap-x-2 ${className}`}>
      {list.map((it, i) => (
        <span
          key={it.label}
          className={`inline-flex min-w-0 items-center gap-1 whitespace-nowrap ${it.optional ? "max-sm:hidden" : ""}`}
        >
          {i > 0 && (
            <span aria-hidden className="mr-1 text-fg-muted/50 max-sm:hidden">
              ·
            </span>
          )}
          <span className="text-fg-muted">{it.label}</span>
          <span className={`truncate text-fg/85 ${it.mono ? "font-mono tabular-nums" : ""}`}>{it.value}</span>
        </span>
      ))}
    </p>
  );
}

/** 資訊欄位群組（Apple「簡介」樣式）：放在 rounded-panel p-2 面板內，欄位是 rounded-row 方塊（同心）。 */
export function InfoGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <dl className={`glass-card relative flex flex-wrap gap-2 rounded-panel p-2 ${className}`}>{children}</dl>
  );
}

/** 單一資訊欄位：上方灰色欄位名、下方值。 */
export function InfoItem({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    // 值會被 truncate 裁切，內部控制項（下拉、連結）的聚焦環改畫在整個方塊上
    <div className="min-w-[150px] flex-1 rounded-row bg-fg/[0.04] px-3.5 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sonar">
      <dt className="text-[11px] font-medium text-fg-muted">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-fg [&_:focus-visible]:outline-none" title={title}>
        {children}
      </dd>
    </div>
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

/** 浮動面板的錨點：按鈕元素（下拉）或游標座標（右鍵選單）。 */
export type PopoverAnchor = HTMLElement | { x: number; y: number };

function anchorRect(a: PopoverAnchor) {
  if (a instanceof HTMLElement) return a.getBoundingClientRect();
  return { left: a.x, right: a.x, top: a.y, bottom: a.y };
}

/**
 * 浮動玻璃面板：portal 到 body（不受列表 overflow 裁切），依錨點定位，下方放不下就往上翻。
 * Esc、點外面、捲動、縮放視窗都會關閉；Esc 關閉時焦點回到錨點按鈕。
 */
export function Popover({
  open,
  onClose,
  anchor,
  align = "end",
  role = "dialog",
  label,
  className = "",
  onKeyDown,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchor: PopoverAnchor | null;
  /** 對齊錨點右緣（end）或左緣（start） */
  align?: "start" | "end";
  role?: "dialog" | "menu";
  label: string;
  className?: string;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const shown = open && anchor !== null;
  // 右鍵選單（游標座標）一律從游標往右下展開，與 macOS 情境選單一致
  const side = anchor instanceof HTMLElement ? align : "start";

  // 先以隱藏狀態渲染量尺寸，再於繪製前算出位置（offsetWidth 不受縮放動畫影響）
  useLayoutEffect(() => {
    if (!shown) return setPos(null);
    const el = ref.current;
    if (!el) return;
    const r = anchorRect(anchor);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 6;
    const margin = 8;
    const left = Math.min(
      Math.max(margin, side === "end" ? r.right - w : r.left),
      window.innerWidth - w - margin,
    );
    let top = r.bottom + gap;
    let up = false;
    if (top + h > window.innerHeight - margin && r.top - gap - h >= margin) {
      top = r.top - gap - h;
      up = true;
    }
    setPos({ left, top, up });
  }, [shown, anchor, side]);

  useEffect(() => {
    if (!shown) return;
    const inside = (t: EventTarget | null) => !!ref.current && t instanceof Node && ref.current.contains(t);
    const onDown = (e: PointerEvent) => {
      if (inside(e.target)) return;
      // 點錨點按鈕交給按鈕自己的 onClick 切換，避免「先關再開」
      if (anchor instanceof HTMLElement && e.target instanceof Node && anchor.contains(e.target)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        if (anchor instanceof HTMLElement) anchor.focus();
      } else if (e.key === "Tab") {
        onCloseRef.current();
      }
    };
    const onScroll = (e: Event) => !inside(e.target) && onCloseRef.current();
    const onResize = () => onCloseRef.current();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [shown, anchor]);

  // 開啟後聚焦：選單聚焦第一個項目（鍵盤可直接上下選），其他聚焦面板本身
  useEffect(() => {
    if (!pos || !ref.current) return;
    const first = role === "menu" ? ref.current.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') : null;
    (first ?? ref.current).focus({ preventScroll: true });
  }, [pos, role]);

  return createPortal(
    <AnimatePresence>
      {shown && (
        <motion.div
          ref={ref}
          role={role}
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={`glass-strong fixed z-[55] max-w-[calc(100vw-16px)] rounded-panel p-2 outline-none ${className}`}
          style={{
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            visibility: pos ? "visible" : "hidden",
            transformOrigin: `${pos?.up ? "bottom" : "top"} ${side === "end" ? "right" : "left"}`,
          }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1, transition: spring }}
          exit={{ opacity: 0, scale: 0.97, transition: exitFast }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** 選單項目：一般動作、連結（下載）、分組標題、分隔線、說明文字。 */
export type MenuEntry =
  | {
      kind?: "item";
      label: ReactNode;
      icon?: ReactNode;
      /** 項目右側的補充（副檔名、目前值…） */
      hint?: ReactNode;
      onSelect?: () => void;
      href?: string;
      danger?: boolean;
      disabled?: boolean;
    }
  | { kind: "section"; label: string }
  | { kind: "separator" }
  | { kind: "note"; label: ReactNode };

/** 下拉／右鍵選單：Popover + role=menu，上下鍵、Home/End 切換項目，選取後自動關閉。 */
export function Menu({
  open,
  onClose,
  anchor,
  items,
  label,
  align = "end",
}: {
  open: boolean;
  onClose: () => void;
  anchor: PopoverAnchor | null;
  items: MenuEntry[];
  label: string;
  align?: "start" | "end";
}) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
    );
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length].focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? list.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
  };

  const itemClass = (danger?: boolean) =>
    `flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-row px-3 text-left text-sm outline-none transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${
      danger
        ? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft"
        : "text-fg hover:bg-fg/[0.07] focus-visible:bg-fg/[0.07]"
    }`;

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} align={align} role="menu" label={label} onKeyDown={onKeyDown} className="min-w-56">
      {items.map((it, i) => {
        if (it.kind === "separator") return <div key={i} role="separator" className="mx-3 my-1 h-px bg-line" />;
        if (it.kind === "section")
          return (
            <p key={i} role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-medium text-fg-muted">
              {it.label}
            </p>
          );
        if (it.kind === "note")
          return (
            <p key={i} role="presentation" className="max-w-64 px-3 pb-1 pt-1.5 text-[11px] leading-relaxed text-fg-muted">
              {it.label}
            </p>
          );
        const content = (
          <>
            {it.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted [&>svg]:h-4 [&>svg]:w-4">{it.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && <span className="shrink-0 font-mono text-[11px] text-fg-muted">{it.hint}</span>}
          </>
        );
        if (it.href && !it.disabled)
          return (
            <a key={i} role="menuitem" href={it.href} onClick={onClose} className={itemClass(it.danger)}>
              {content}
            </a>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onSelect?.();
            }}
            className={itemClass(it.danger)}
          >
            {content}
          </button>
        );
      })}
    </Popover>
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
            className={`glass-strong relative flex max-h-[88vh] w-full ${wide ? "max-w-2xl" : "max-w-lg"} flex-col overflow-hidden rounded-panel outline-none`}
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
