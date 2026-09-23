/**
 * 全域任務面板：header 右上抽屜，顯示所有進行中任務的真實進度。
 * 每個任務可點標題跳到媒體頁、點「終止」送出取消請求。
 */
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { jobStageLabel, MODE_INFO, type ModeKey } from "../lib/format";
import { exitFast, spring } from "../lib/motion";
import { WaveformPulse } from "./sonar";
import { Badge, Button, MetaLine, ProgressBar } from "./ui";

export function TaskDrawer() {
  const { activeJobs, toast, refreshJobs } = useApp();
  const [open, setOpen] = useState(false);

  /** 終止任務：後端設旗標，worker 在下個進度回報點停止（協作式取消）。 */
  const cancel = async (id: string) => {
    try {
      await api.cancelJob(id);
      refreshJobs();
      toast("已送出終止請求，任務將在數秒內停止", "info");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const busy = activeJobs.length > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={busy ? `任務：${activeJobs.length} 個進行中` : "任務"}
        title="任務"
        className={`press glass relative flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full pl-3 text-sm ${
          busy ? "pr-2 text-amber" : "pr-3.5 text-fg-muted hover:text-fg"
        }`}
      >
        {busy ? (
          <WaveformPulse size="sm" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
            <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
          </svg>
        )}
        <span className="hidden sm:inline">任務</span>
        {busy && (
          <Badge tone="amber" className="font-mono tabular-nums">
            {activeJobs.length}
          </Badge>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              className="glass-strong absolute right-0 z-40 mt-2 w-96 max-w-[calc(100vw-2rem)] origin-top-right rounded-panel p-2"
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: spring }}
              exit={{ opacity: 0, scale: 0.96, y: -4, transition: exitFast }}
            >
              {activeJobs.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-fg-muted">目前沒有進行中的任務</p>
              ) : (
                <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
                  {activeJobs.map((job) => (
                    <li key={job.id} className="rounded-row bg-fg/[0.04] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          to={`/media/${job.media_id}`}
                          onClick={() => setOpen(false)}
                          className="min-w-0 truncate text-sm font-medium hover:text-sonar"
                        >
                          {job.media_title || job.url || job.media_id}
                        </Link>
                        <Button
                          variant="glass-danger"
                          size="sm"
                          onClick={() => cancel(job.id)}
                          disabled={job.cancel_requested}
                        >
                          {job.cancel_requested ? "終止中…" : "終止"}
                        </Button>
                      </div>
                      <ProgressBar value={job.progress} processing className="mt-2.5" />
                      <MetaLine
                        className="mt-2"
                        items={[
                          { label: "狀態", value: jobStageLabel(job) },
                          { label: "進度", value: `${job.progress}%`, mono: true },
                          job.type === "transcribe" && job.mode
                            ? { label: "模式", value: MODE_INFO[job.mode as ModeKey].name }
                            : { label: "類型", value: `下載 ${job.format?.toUpperCase() ?? ""}` },
                          !!job.speed && { label: "速度", value: job.speed, mono: true },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
