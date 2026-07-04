/**
 * 全域狀態：toast 通知 + 進行中任務輪詢。
 *
 * 輪詢策略：有進行中任務時每 2 秒抓 /api/jobs?active=true，閒置時放慢到 6 秒。
 * 任務從 active 集合消失（完成/失敗/終止）時遞增 jobsVersion，
 * 各頁面把它放進 useEffect 依賴即可自動重新抓資料。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { Job } from "../lib/types";

/* ---------- Toast ---------- */

export interface Toast {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}

interface AppState {
  toasts: Toast[];
  /** 顯示一則 toast（4.5 秒後自動消失，最多同時 4 則） */
  toast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  /** 目前進行中（queued/processing）的任務，全站共用 */
  activeJobs: Job[];
  /** 任一任務完成的遞增訊號，頁面靠它重新抓列表 */
  jobsVersion: number;
  /** 立即重新輪詢一次（建立/終止任務後呼叫，不等下個輪詢週期） */
  refreshJobs: () => void;
}

const Ctx = createContext<AppState | null>(null);

let toastSeq = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [jobsVersion, setJobsVersion] = useState(0);
  const prevActiveIds = useRef<Set<string>>(new Set());

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: Toast["kind"] = "info") => {
      const id = ++toastSeq;
      setToasts((t) => [...t.slice(-3), { id, message, kind }]);
      setTimeout(() => dismissToast(id), 4500);
    },
    [dismissToast],
  );

  const poll = useCallback(async () => {
    try {
      const jobs = await api.listJobs(true);
      const ids = new Set(jobs.map((j) => j.id));
      // 有任務從 active 消失 = 完成或失敗 → 通知頁面刷新
      let finished = false;
      for (const id of prevActiveIds.current) if (!ids.has(id)) finished = true;
      prevActiveIds.current = ids;
      setActiveJobs(jobs);
      if (finished) setJobsVersion((v) => v + 1);
    } catch {
      /* 後端未啟動時安靜略過，啟動後自然恢復 */
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const loop = async () => {
      await poll();
      if (stopped) return;
      // 有進行中任務時 2s 一次；閒置時放慢
      timer = setTimeout(loop, prevActiveIds.current.size > 0 ? 2000 : 6000);
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [poll]);

  const refreshJobs = useCallback(() => {
    poll();
    setJobsVersion((v) => v + 1);
  }, [poll]);

  return (
    <Ctx.Provider value={{ toasts, toast, dismissToast, activeJobs, jobsVersion, refreshJobs }}>
      {children}
    </Ctx.Provider>
  );
}

/** 取用全域狀態的 hook；必須在 AppProvider 內使用。 */
export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp 必須在 AppProvider 內使用");
  return ctx;
}
