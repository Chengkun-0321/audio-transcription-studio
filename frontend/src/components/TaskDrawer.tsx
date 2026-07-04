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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          activeJobs.length > 0
            ? "border-amber/50 bg-amber-soft text-amber"
            : "border-line text-fg-muted hover:bg-surface-hover"
        }`}
      >
        {activeJobs.length > 0 ? (
          <>
            <WaveformPulse size="sm" />
            <span className="font-mono">{activeJobs.length}</span> 個任務進行中
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
              className="absolute right-0 z-40 mt-2 w-96 rounded-xl border border-line bg-surface p-3 shadow-2xl"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {activeJobs.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-fg-muted">目前沒有進行中的任務</p>
              ) : (
                <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                  {activeJobs.map((job) => (
                    <li key={job.id} className="rounded-lg border border-line/60 p-3">
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
                            className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
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
