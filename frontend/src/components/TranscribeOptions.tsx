/**
 * 轉錄設定表單：語言（常用膠囊＋其他下拉）、Whisper 模型（下拉＋本機下載狀態）、
 * 進階摺疊區（說話者識別＋人數／音訊修復，iOS 設定列樣式）。上傳彈窗與媒體詳細頁共用。
 */
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { COMMON_LANGUAGES, OTHER_LANGUAGES, fmtBytes } from "../lib/format";
import type { WhisperModel } from "../lib/types";
import { Select, Switch } from "./ui";

export interface TranscribeSettings {
  /** Whisper 模型 key（WhisperModel.key） */
  model: string;
  language: string;
  diarization: boolean;
  /** 說話者人數；null = 自動判斷（僅說話者識別開啟時送出） */
  num_speakers: number | null;
  denoise: boolean;
}

/** 與後端 config.DEFAULT_MODEL 相同；清單載入後若不存在會改用清單標示的預設 */
const DEFAULT_MODEL = "large-v3-turbo";
/** 上次選的模型存在 localStorage（個人偏好；讀寫失敗就用預設） */
const MODEL_KEY = "whisper-model";
/** 大型模型：選取時提醒記憶體壓力 */
const LARGE_MODELS = new Set(["large-v2", "large-v3"]);

/** 預設設定：模型沿用上次選擇。用函式而非常數，每次開表單才讀 localStorage。 */
export function defaultSettings(): TranscribeSettings {
  let model = DEFAULT_MODEL;
  try {
    model = localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
  } catch {
    /* 無痕模式等情況讀不到，用預設 */
  }
  return { model, language: "auto", diarization: false, num_speakers: null, denoise: false };
}

const SPEAKER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 下拉選項文字：「large-v3-turbo（推薦）· 1.6 GB · 已下載」 */
function optionLabel(m: WhisperModel) {
  const state = m.status === "downloaded" ? " · 已下載" : m.status === "downloading" ? " · 下載中" : "";
  return `${m.key}${m.default ? "（推薦）" : ""} · ${fmtBytes(m.download_mb * 1e6)}${state}`;
}

/** 選中模型下方的狀態說明 */
function statusText(m: WhisperModel) {
  if (m.status === "downloaded") return "已下載，可直接使用。";
  if (m.status === "downloading") return `下載中 ${m.progress ?? 0}%，轉錄會等下載完成後開始。`;
  return `尚未下載，第一次使用會自動下載約 ${fmtBytes(m.download_mb * 1e6)}。`;
}

const chip = (active: boolean) =>
  `press h-8 cursor-pointer rounded-full px-3.5 text-sm transition-colors ${
    active
      ? "bg-sonar-soft font-medium text-sonar shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--sonar)_45%,transparent)]"
      : "bg-fg/[0.05] text-fg-muted hover:bg-fg/[0.08] hover:text-fg"
  }`;

export function TranscribeOptions({
  value,
  onChange,
}: {
  value: TranscribeSettings;
  onChange: (v: TranscribeSettings) => void;
}) {
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [showOthers, setShowOthers] = useState(
    OTHER_LANGUAGES.some((l) => l.code === value.language),
  );
  const [showAdvanced, setShowAdvanced] = useState(value.diarization || value.denoise);

  useEffect(() => {
    api.listModels().then(setModels).catch(() => {});
  }, []);

  // 記住的模型已不在清單（清單改版）時換成預設，避免送出後被後端拒絕
  useEffect(() => {
    if (models.length && !models.some((m) => m.key === value.model)) {
      const fallback = models.find((m) => m.default) ?? models[0];
      onChange({ ...value, model: fallback.key });
    }
  }, [models, value, onChange]);

  const selectModel = (model: string) => {
    onChange({ ...value, model });
    try {
      localStorage.setItem(MODEL_KEY, model);
    } catch {
      /* 存不了就只影響這次 */
    }
  };

  const current = models.find((m) => m.key === value.model);

  return (
    <div className="flex flex-col gap-5">
      {/* 語言 */}
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-fg-muted">語音語言（原生轉錄，非翻譯）</p>
        <div className="flex flex-wrap items-center gap-2">
          {COMMON_LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => onChange({ ...value, language: l.code })}
              className={chip(value.language === l.code)}
            >
              {l.label}
            </button>
          ))}
          {!showOthers ? (
            <button type="button" onClick={() => setShowOthers(true)} className={chip(false)}>
              其他…
            </button>
          ) : (
            <Select
              size="sm"
              aria-label="其他語言"
              value={OTHER_LANGUAGES.some((l) => l.code === value.language) ? value.language : ""}
              onChange={(e) => e.target.value && onChange({ ...value, language: e.target.value })}
            >
              <option value="" disabled>
                其他語言…
              </option>
              {OTHER_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {/* Whisper 模型 */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="whisper-model" className="text-xs font-medium tracking-wide text-fg-muted">
            Whisper 模型
          </label>
          <Link to="/models" className="text-xs text-fg-muted hover:text-sonar">
            管理模型
          </Link>
        </div>
        <Select id="whisper-model" value={value.model} onChange={(e) => selectModel(e.target.value)}>
          {models.length === 0 ? (
            <option value={value.model}>{value.model}</option>
          ) : (
            models.map((m) => (
              <option key={m.key} value={m.key}>
                {optionLabel(m)}
              </option>
            ))
          )}
        </Select>
        {current && (
          <p className="mt-2 px-1 text-xs leading-relaxed text-fg-muted">
            {current.note}。{statusText(current)}
            {LARGE_MODELS.has(current.key) && "大型模型在同時開著其他大型程式時可能感受到記憶體壓力。"}
          </p>
        )}
      </div>

      {/* 進階設定 */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          aria-expanded={showAdvanced}
          className="flex cursor-pointer items-center gap-1.5 text-xs font-medium tracking-wide text-fg-muted hover:text-fg"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] ${showAdvanced ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
          進階設定
        </button>
        {showAdvanced && (
          <motion.div
            className="mt-3 divide-y divide-line overflow-hidden rounded-row bg-fg/[0.04]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          >
            <label className="flex cursor-pointer items-center gap-4 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">說話者識別</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                  標記每段話由誰說，句中換人會自動分句。以 GPU 運算並與轉錄同時進行，一小時音檔約需
                  4 分鐘。
                </span>
              </span>
              <Switch checked={value.diarization} onChange={(v) => onChange({ ...value, diarization: v })} />
            </label>
            {value.diarization && (
              <div className="flex items-center gap-4 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">說話者人數</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                    已知人數時指定，分辨會更準確。
                  </span>
                </span>
                <Select
                  size="sm"
                  aria-label="說話者人數"
                  value={value.num_speakers ?? ""}
                  onChange={(e) =>
                    onChange({ ...value, num_speakers: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">自動判斷</option>
                  {SPEAKER_COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {n} 人
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-4 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">音訊修復（AI 去噪＋語音增強）</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                  適合背景噪音明顯的錄音；乾淨的音檔不需要開啟。
                </span>
              </span>
              <Switch checked={value.denoise} onChange={(v) => onChange({ ...value, denoise: v })} />
            </label>
          </motion.div>
        )}
      </div>
    </div>
  );
}
