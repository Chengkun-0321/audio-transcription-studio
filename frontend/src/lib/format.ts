/** 顯示格式化工具與 UI 常數（語言清單、階段標籤、任務模型名）。 */
import type { Job } from "./types";

/** 秒數 → "3:05" / "1:02:03"（列表用，前面要搭配「時長」標籤）；未知時為 "—" */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** 秒數 → "1 小時 22 分 17 秒" / "22 分 17 秒" / "45 秒"（詳細頁資訊欄位） */
export function fmtDurationLong(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} 小時`);
  if (h > 0 || m > 0) parts.push(`${m} 分`);
  parts.push(`${sec} 秒`);
  return parts.join(" ");
}

/** 秒數 → "00:12" / "1:02:03"（逐字稿時間戳） */
export const fmtTimestamp = (seconds: number): string => {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** ISO 時間 → "今天 14:25" / "昨天 14:25" / "9月3日 14:25" / "2025年9月3日 14:25"（列表用，24 小時制） */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `今天 ${hhmm(d)}`;
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm(d)}`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(d)}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** ISO 時間 → "2026年9月3日 14:25"（詳細頁，一律含年份） */
export function fmtDateFull(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(d)}`;
}

/** 媒體來源 → 顯示文字 */
export const SOURCE_LABEL: Record<"upload" | "youtube", string> = {
  upload: "本機上傳",
  youtube: "YouTube",
};

/** 媒體類型＋副檔名 → "影片 · MP4" / "音訊 · M4A" */
export function mediaTypeLabel(kind: "video" | "audio" | null, ext: string | null): string {
  const k = kind === "video" ? "影片" : kind === "audio" ? "音訊" : "媒體";
  return ext ? `${k} · ${ext.replace(/^\./, "").toUpperCase()}` : k;
}

/** 位元組 → "74 MB" / "1.6 GB"（十進位，與 Hugging Face 顯示一致） */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

/** 舊版任務只存轉錄模式，對應回模型名（同後端 config.LEGACY_MODES） */
const LEGACY_MODES: Record<string, string> = {
  cheetah: "small",
  dolphin: "large-v3-turbo",
  whale: "large-v3",
};

/** 轉錄任務使用的 Whisper 模型名（相容舊版的 mode 欄位） */
export function jobModel(job: Pick<Job, "model" | "mode">): string {
  return job.model ?? (job.mode && LEGACY_MODES[job.mode]) ?? "—";
}

/** 常用語言：直接顯示為按鈕；其他語言收在下拉。 */
export const COMMON_LANGUAGES = [
  { code: "auto", label: "自動偵測" },
  { code: "zh", label: "繁體中文" },
  { code: "en", label: "English" },
];

export const OTHER_LANGUAGES = [
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ms", label: "Bahasa Melayu" },
  { code: "hi", label: "हिन्दी" },
  { code: "ar", label: "العربية" },
  { code: "tr", label: "Türkçe" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "uk", label: "Українська" },
];

/** 語言代碼 → 顯示名稱；未知代碼原樣顯示。 */
export function langLabel(code: string | undefined): string {
  if (!code) return "—";
  const all = [...COMMON_LANGUAGES, ...OTHER_LANGUAGES];
  return all.find((l) => l.code === code)?.label ?? code;
}

/** 任務階段 → 顯示文字。 */
export const STAGE_LABEL: Record<string, string> = {
  fetch_model: "下載模型中",
  denoise: "音訊修復中",
  transcribe: "轉錄中",
  diarize: "識別說話者",
  export: "產生輸出",
  download: "下載中",
};

/** 進行中任務的顯示標籤：已按過終止時優先顯示「終止中」 */
export function jobStageLabel(job: {
  stage: string | null;
  cancel_requested?: boolean;
}): string {
  if (job.cancel_requested) return "終止中…";
  return job.stage ? STAGE_LABEL[job.stage] : "排隊中";
}
