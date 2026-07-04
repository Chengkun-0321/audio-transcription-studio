/** 通用 UI 元件：進度條、彈窗、確認框、空狀態、Toast */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { useApp } from "../context/AppContext";
import { CheckDraw } from "./sonar";

/** 進度條：processing=true 顯示琥珀色（進行中），否則聲納綠（完成）。 */
export function ProgressBar({
  value,
  processing = false,
  className = "",
}: {
  value: number;
  processing?: boolean;
  className?: string;
}) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          processing ? "bg-amber" : "bg-sonar"
        }`}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/** 彈窗：Esc 或點背景關閉；wide=true 加寬（上傳彈窗用）。 */
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={`max-h-[88vh] w-full ${wide ? "max-w-2xl" : "max-w-lg"} overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl`}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{title}</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                aria-label="關閉"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {children}
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
        <button
          onClick={onCancel}
          className="rounded-lg border border-line px-4 py-2 text-sm transition-colors hover:bg-surface-hover"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 ${
            danger ? "bg-danger" : "bg-sonar"
          }`}
        >
          {confirmLabel}
        </button>
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
      <svg viewBox="0 0 64 24" className="h-8 w-20 text-line" aria-hidden>
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
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-sm shadow-lg backdrop-blur ${
              t.kind === "error"
                ? "border-danger/40 bg-surface text-danger"
                : "border-line bg-surface text-fg"
            }`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
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
