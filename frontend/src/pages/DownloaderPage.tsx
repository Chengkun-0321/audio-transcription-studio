/**
 * 首頁／下載器：貼 YouTube 網址 → 選 MP4/MP3 與目的資料夾 → 背景下載。
 * 下方即時顯示進行中的下載（進度 + 速度），完成後出現在媒體庫。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { STAGE_LABEL } from "../lib/format";
import type { Folder } from "../lib/types";
import { WaveformPulse } from "../components/sonar";
import { ProgressBar } from "../components/ui";

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
    <div className="mx-auto flex max-w-2xl flex-col gap-10 pt-10">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          聽見<span className="text-sonar">深處</span>的聲音
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          貼上 YouTube 網址下載影音，或到媒體庫上傳檔案，在本機完成轉錄——一切不離開這台電腦。
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-4">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="https://www.youtube.com/watch?v=…"
            className="w-full rounded-xl border border-line bg-ink px-4 py-3 font-mono text-sm outline-none transition-colors placeholder:text-fg-muted/60 focus:border-sonar"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {(["mp4", "mp3"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`rounded-lg border px-4 py-1.5 font-mono text-sm uppercase transition-colors ${
                    format === f
                      ? "border-sonar bg-sonar-soft font-medium text-sonar"
                      : "border-line text-fg-muted hover:bg-surface-hover"
                  }`}
                >
                  {f === "mp4" ? "MP4 影片" : "MP3 音訊"}
                </button>
              ))}
              <select
                value={folder ?? ""}
                onChange={(e) => setFolder(e.target.value || null)}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg-muted outline-none focus:border-sonar"
              >
                <option value="">存到：未分類</option>
                {folders.map((f) => (
                  <option key={f.name} value={f.name}>
                    存到：{f.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={submit}
              disabled={submitting || !url.trim()}
              className="rounded-xl bg-sonar px-6 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              下載
            </button>
          </div>
        </div>
      </div>

      {downloads.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-fg-muted">
            <WaveformPulse size="sm" /> 下載中
          </h2>
          {downloads.map((j) => (
            <div key={j.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="truncate text-sm">{j.media_title || j.url}</span>
                <span className="shrink-0 font-mono text-xs text-amber">
                  {j.progress}%{j.speed ? ` · ${j.speed}` : ""}
                </span>
              </div>
              <ProgressBar value={j.progress} processing />
              <p className="mt-1.5 text-xs text-fg-muted">
                {j.stage ? STAGE_LABEL[j.stage] : "排隊中"} · {j.format?.toUpperCase()}
              </p>
            </div>
          ))}
          <p className="text-xs text-fg-muted">
            完成後會出現在 <Link to="/library" className="text-sonar hover:underline">媒體庫</Link>，可直接播放或轉錄。
          </p>
        </div>
      )}
    </div>
  );
}
