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
import { ProgressBar } from "./ui";

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
        aria-label={busy ? `${activeJobs.length} 個任務進行中` : "任務"}
        className={`press glass relative flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm ${
          busy ? "text-amber" : "text-fg-muted hover:text-fg"
        }`}
      >
        {busy ? (
          <>
            <WaveformPulse size="sm" />
            <span className="font-mono">{activeJobs.length}</span>
            <span className="hidden sm:inline">個任務進行中</span>
          </>
        ) : (
          "任務"
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              className="glass-strong absolute right-0 z-40 mt-2 w-96 max-w-[calc(100vw-1.5rem)] origin-top-right rounded-3xl p-2"
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: spring }}
              exit={{ opacity: 0, scale: 0.96, y: -4, transition: exitFast }}
            >
              {activeJobs.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-fg-muted">目前沒有進行中的任務</p>
              ) : (
                <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
                  {activeJobs.map((job) => (
                    <li key={job.id} className="rounded-2xl bg-fg/[0.04] p-3">
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <Link
                          to={`/media/${job.media_id}`}
                          onClick={() => setOpen(false)}
                          className="truncate text-sm font-medium hover:text-sonar"
                        >
                          {job.media_title || job.url || job.media_id}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs text-amber">{job.progress}%</span>
                          <button
                            onClick={() => cancel(job.id)}
                            disabled={job.cancel_requested}
                            className="press cursor-pointer rounded-full bg-fg/[0.06] px-2.5 py-0.5 text-xs text-fg-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                            title="終止任務"
                          >
                            {job.cancel_requested ? "終止中" : "終止"}
                          </button>
                        </span>
                      </div>
                      <ProgressBar value={job.progress} processing />
                      <p className="mt-1.5 flex justify-between text-xs text-fg-muted">
                        <span>
                          {jobStageLabel(job)}
                          {job.type === "transcribe" && job.mode
                            ? ` · ${MODE_INFO[job.mode as ModeKey].name}模式`
                            : ""}
                        </span>
                        {job.speed && <span className="font-mono">{job.speed}</span>}
                      </p>
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
