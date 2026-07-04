/** 顯示格式化工具與 UI 常數（模式資訊、語言清單、階段標籤）。 */

/** 秒數 → "3:05" / "1:02:03"（列表、播放器用） */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "--:--";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
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

/** ISO 時間 → 今天顯示時刻（下午03:15）、其他日期顯示月/日。 */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

/** 三檔轉錄模式的顯示資訊（實際模型對應在後端 config.MODE_MODELS）。 */
export const MODE_INFO = {
  cheetah: { name: "獵豹", tagline: "最快 · 快速預覽", model: "whisper-small" },
  dolphin: { name: "海豚", tagline: "平衡 · 日常推薦", model: "large-v3-turbo" },
  whale: { name: "鯨魚", tagline: "最準 · 重要內容", model: "large-v3" },
} as const;

export type ModeKey = keyof typeof MODE_INFO;

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
