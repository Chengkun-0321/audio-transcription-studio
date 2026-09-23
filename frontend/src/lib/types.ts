/** 前後端共用的資料型別（後端 JSON 的 TypeScript 對應）。 */

/** 任務：轉錄或下載，狀態與進度由後端 worker 寫回 jobs/<id>.json。 */
export interface Job {
  id: string;
  type: "transcribe" | "download";
  /** 所屬媒體 ID */
  media_id: string;
  /** 狀態機：queued → processing → done | error | cancelled */
  status: "queued" | "processing" | "done" | "error" | "cancelled";
  /** 進行中的階段（決定顯示文字），非進行中為 null */
  stage: "fetch_model" | "denoise" | "transcribe" | "diarize" | "export" | "download" | null;
  /** 真實進度 0–100（依階段權重合成，非動畫） */
  progress: number;
  /** 使用者已按終止、worker 尚未停止時為 true（顯示「終止中…」） */
  cancel_requested?: boolean;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  // -- 轉錄任務專屬 --
  /** Whisper 模型 key（WhisperModel.key）；顯示一律用 format.ts 的 jobModel() */
  model?: string;
  /** 舊版任務只有轉錄模式（cheetah/dolphin/whale），由 jobModel() 對應回模型 */
  mode?: string;
  language?: string;
  diarization?: boolean;
  /** 指定的說話者人數；null = 自動判斷 */
  num_speakers?: number | null;
  denoise?: boolean;
  /** 自動偵測模式下實際偵測到的語言 */
  detected_language?: string;
  // -- 下載任務專屬 --
  url?: string;
  format?: string;
  /** 下載速度字串（yt-dlp 提供），如 "10.84MiB/s" */
  speed?: string | null;
  /** 列表 API 附帶的媒體標題（顯示用） */
  media_title?: string | null;
}

/** 媒體檔：一個上傳檔或一支下載的影音。 */
export interface Media {
  id: string;
  title: string;
  original_filename: string;
  source_type: "upload" | "youtube";
  source_url: string | null;
  /** 副檔名（含點）；YouTube 下載完成前為 null */
  ext: string | null;
  /** 決定站內用 <video> 還是 <audio> 播放 */
  media_kind: "video" | "audio" | null;
  duration_seconds: number | null;
  created_at: string;
  /** 所屬資料夾；null = 未分類（inbox） */
  folder: string | null;
  /** 此媒體的所有任務（新到舊） */
  jobs: Job[];
  latest_job: Job | null;
  /** 是否至少有一次完成的轉錄 */
  has_transcript: boolean;
}

/** 資料夾（實體目錄）與其媒體數。 */
export interface Folder {
  name: string;
  media_count: number;
}

/** 逐字時間戳（word-level timestamps）。 */
/** 轉錄片段：一句話的時間範圍、文字與說話者（逐字時間戳 words 只存在後端檔案，API 不回傳）。 */
export interface Segment {
  start: number;
  end: number;
  text: string;
  /** 說話者標籤（S1/S2...），僅開啟說話者識別時存在 */
  speaker?: string;
}

/** Whisper 模型與本機狀態（清單與順序由後端 config.WHISPER_MODELS 決定）。 */
export interface WhisperModel {
  /** 模型名稱，同時是建立任務時送出的值（如 "large-v3-turbo"） */
  key: string;
  /** Hugging Face repo */
  repo: string;
  /** 參數量（如 "809M"） */
  params: string;
  /** 首次使用需下載的大小（MB，約略值） */
  download_mb: number;
  note: string;
  /** 未指定時的預設模型 */
  default: boolean;
  status: "downloaded" | "downloading" | "absent";
  /** 下載進度 0–100；非下載中為 null */
  progress: number | null;
  /** 本機實際佔用（含下載到一半的檔案） */
  size_bytes: number;
  /** 有排隊中或執行中的轉錄任務用到它（此時不能刪除） */
  in_use: boolean;
}

/** 完整轉錄結果（jobs/<id>.segments.json 的內容，不含逐字時間戳）。 */
export interface Transcript {
  language: string;
  segments: Segment[];
}
