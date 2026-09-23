/**
 * 首頁／下載器：貼 YouTube 網址 → 選 MP4/MP3 與目的資料夾 → 背景下載。
 * 下方即時顯示進行中的下載（進度 + 速度），完成後出現在媒體庫。
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { STAGE_LABEL } from "../lib/format";
import { exitFast, spring } from "../lib/motion";
import type { Folder } from "../lib/types";
import { WaveformPulse } from "../components/sonar";
import { Button, ProgressBar, Segmented, Select } from "../components/ui";

const FEATURES = ["Metal 加速轉錄", "說話者識別", "AI 降噪", "TXT · SRT · DOCX"];

export function DownloaderPage() {
  const { toast, activeJobs, refreshJobs } = useApp();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4");
  const [folder, setFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.listFolders().then(setFolders).catch(() => {});
  }, []);

  const downloads = activeJobs.filter((j) => j.type === "download");

  const submit = async () => {
    const u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) {
      toast("請貼上完整的網址（http:// 或 https:// 開頭）", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.downloadYoutube(u, format, folder);
      setUrl("");
      refreshJobs();
      toast("已加入下載佇列", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 pt-6 md:pt-14">
      <div className="text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
          聽見
          <span className="bg-linear-to-r from-sonar to-[#6f8dff] bg-clip-text text-transparent">深處</span>
          的聲音
        </h1>
        <p className="mx-auto mt-4 max-w-md break-keep text-[15px] leading-relaxed text-fg-muted">
          貼上 YouTube 網址下載影音，或到媒體庫上傳檔案，
          <wbr />
          在本機完成轉錄——一切不離開這台電腦。
        </p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-fg-muted">
          {FEATURES.map((f) => (
            <li key={f} className="glass relative rounded-full px-3 py-1">
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="glass-card relative rounded-[32px] p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <label className="relative block">
            <span className="sr-only">YouTube 網址</span>
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden
            >
              <path
                d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"
                strokeLinecap="round"
              />
            </svg>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="https://www.youtube.com/watch?v=…"
              className="field h-14 w-full rounded-2xl pl-12 pr-4 font-mono text-[15px] placeholder:text-fg-muted/60"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
              <Segmented
                label="下載格式"
                value={format}
                onChange={setFormat}
                options={[
                  { value: "mp4", label: "MP4 影片" },
                  { value: "mp3", label: "MP3 音訊" },
                ]}
              />
              <Select
                aria-label="存放資料夾"
                value={folder ?? ""}
                onChange={(e) => setFolder(e.target.value || null)}
                className="min-w-40 flex-1 sm:flex-none"
              >
                <option value="">存到：未分類</option>
                {folders.map((f) => (
                  <option key={f.name} value={f.name}>
                    存到：{f.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={submit}
              disabled={submitting || !url.trim()}
              className="max-sm:w-full"
            >
              {submitting ? "加入中…" : "下載"}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path d="M12 5v12m0 0l-5-5m5 5l5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {downloads.length > 0 && (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, transition: exitFast }}
          >
            <h2 className="flex items-center gap-2 px-1 font-display text-sm font-semibold text-fg-muted">
              <WaveformPulse size="sm" /> 下載中
            </h2>
            <AnimatePresence initial={false}>
              {downloads.map((j) => (
                <motion.div
                  key={j.id}
                  layout
                  className="glass-card relative rounded-3xl p-4"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
                  exit={{ opacity: 0, scale: 0.98, transition: exitFast }}
                >
                  <div className="mb-2.5 flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">{j.media_title || j.url}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-amber">
                      {j.progress}%{j.speed ? ` · ${j.speed}` : ""}
                    </span>
                  </div>
                  <ProgressBar value={j.progress} processing />
                  <p className="mt-2 text-xs text-fg-muted">
                    {j.stage ? STAGE_LABEL[j.stage] : "排隊中"} · {j.format?.toUpperCase()}
                  </p>
                </motion.div>
              ))}
            </AnimatePresence>
            <p className="px-1 text-xs text-fg-muted">
              完成後會出現在{" "}
              <Link to="/library" className="text-sonar hover:underline">
                媒體庫
              </Link>
              ，可直接播放或轉錄。
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
