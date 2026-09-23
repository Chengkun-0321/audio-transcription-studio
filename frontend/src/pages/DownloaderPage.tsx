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
import { Button, MetaLine, ProgressBar, Segmented, Select } from "../components/ui";

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

      {/* 表單：每個控制項上方都有欄位名稱；同一列控制項皆為 40px */}
      <div className="glass-card relative flex flex-col gap-5 rounded-panel p-5 sm:p-6">
        <label className="flex flex-col gap-2">
          <span className="px-1 text-xs font-medium text-fg-muted">YouTube 網址</span>
          <span className="relative block">
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
              className="field h-12 w-full rounded-full pl-12 pr-5 font-mono text-[15px] placeholder:text-fg-muted/60"
            />
          </span>
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <span id="dl-format-label" className="px-1 text-xs font-medium text-fg-muted">
              下載格式
            </span>
            <Segmented
              label="下載格式"
              value={format}
              onChange={setFormat}
              options={[
                { value: "mp4", label: "MP4 影片" },
                { value: "mp3", label: "MP3 音訊" },
              ]}
            />
          </div>
          <label className="flex min-w-40 flex-1 flex-col gap-2 sm:flex-none">
            <span className="px-1 text-xs font-medium text-fg-muted">存到資料夾</span>
            <Select value={folder ?? ""} onChange={(e) => setFolder(e.target.value || null)}>
              <option value="">未分類</option>
              {folders.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="primary"
            onClick={submit}
            disabled={submitting || !url.trim()}
            className="px-6 max-sm:w-full sm:ml-auto"
          >
            {submitting ? "加入中…" : "開始下載"}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path d="M12 5v12m0 0l-5-5m5 5l5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
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
                  className="glass-card relative rounded-panel p-4"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
                  exit={{ opacity: 0, scale: 0.98, transition: exitFast }}
                >
                  <div className="mb-2.5 flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">{j.media_title || j.url}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-amber">{j.progress}%</span>
                  </div>
                  <ProgressBar value={j.progress} processing />
                  <MetaLine
                    className="mt-2"
                    items={[
                      { label: "狀態", value: j.stage ? STAGE_LABEL[j.stage] : "排隊中" },
                      { label: "格式", value: j.format?.toUpperCase() ?? "—" },
                      !!j.speed && { label: "速度", value: j.speed, mono: true },
                    ]}
                  />
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
