/**
 * 轉錄設定表單：語言（常用按鈕＋其他下拉）、三檔模式卡片、
 * 進階摺疊區（說話者識別／音訊修復）。上傳彈窗與媒體詳細頁共用。
 */
import { useState } from "react";
import {
  COMMON_LANGUAGES,
  MODE_INFO,
  OTHER_LANGUAGES,
  type ModeKey,
} from "../lib/format";

export interface TranscribeSettings {
  mode: ModeKey;
  language: string;
  diarization: boolean;
  denoise: boolean;
}

export const DEFAULT_SETTINGS: TranscribeSettings = {
  mode: "dolphin",
  language: "auto",
  diarization: false,
  denoise: false,
};

const MODE_GLYPHS: Record<ModeKey, string> = {
  // 極簡線條速度感：一 / 二 / 三 道波
  cheetah: "M2 12h20M6 8h12",
  dolphin: "M2 9h20M2 15h14",
  whale: "M2 7h20M2 12h20M2 17h14",
};

export function TranscribeOptions({
  value,
  onChange,
}: {
  value: TranscribeSettings;
  onChange: (v: TranscribeSettings) => void;
}) {
  const [showOthers, setShowOthers] = useState(
    OTHER_LANGUAGES.some((l) => l.code === value.language),
  );
  const [showAdvanced, setShowAdvanced] = useState(value.diarization || value.denoise);

  return (
    <div className="flex flex-col gap-5">
      {/* 語言 */}
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-fg-muted">語音語言（原生轉錄，非翻譯）</p>
        <div className="flex flex-wrap gap-2">
          {COMMON_LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => onChange({ ...value, language: l.code })}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                value.language === l.code
                  ? "border-sonar bg-sonar-soft font-medium text-sonar"
                  : "border-line text-fg-muted hover:bg-surface-hover"
              }`}
            >
              {l.label}
            </button>
          ))}
          {!showOthers ? (
            <button
              type="button"
              onClick={() => setShowOthers(true)}
              className="rounded-lg border border-dashed border-line px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-hover"
            >
              其他…
            </button>
          ) : (
            <select
              value={OTHER_LANGUAGES.some((l) => l.code === value.language) ? value.language : ""}
              onChange={(e) => e.target.value && onChange({ ...value, language: e.target.value })}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-sonar"
            >
              <option value="" disabled>
                其他語言…
              </option>
              {OTHER_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 三檔模式 */}
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-fg-muted">轉錄模式</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(MODE_INFO) as ModeKey[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...value, mode: m })}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                value.mode === m
                  ? "border-sonar bg-sonar-soft"
                  : "border-line hover:bg-surface-hover"
              }`}
            >
              <span className="flex w-full items-center justify-between">
                <span className={`font-display text-sm font-semibold ${value.mode === m ? "text-sonar" : ""}`}>
                  {MODE_INFO[m].name}
                </span>
                <svg viewBox="0 0 24 24" className={`h-4 w-4 ${value.mode === m ? "text-sonar" : "text-fg-muted"}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={MODE_GLYPHS[m]} />
                </svg>
              </span>
              <span className="text-xs leading-snug text-fg-muted">{MODE_INFO[m].tagline}</span>
              <span className="font-mono text-[10px] text-fg-muted/70">{MODE_INFO[m].model}</span>
            </button>
          ))}
        </div>
        {value.mode === "whale" && (
          <p className="mt-2 text-xs leading-relaxed text-fg-muted">
            鯨魚使用最大模型，同時開著其他大型程式時可能感受到記憶體壓力。
          </p>
        )}
      </div>

      {/* 進階設定 */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-fg-muted hover:text-fg"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
          進階設定
        </button>
        {showAdvanced && (
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={value.diarization}
                onChange={(e) => onChange({ ...value, diarization: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm">說話者識別</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                  標記每段話由誰說。此功能在本機以 CPU 運算，一小時音檔約需 10–20
                  分鐘，視發言人數與音檔品質而定。
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={value.denoise}
                onChange={(e) => onChange({ ...value, denoise: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm">音訊修復（AI 去噪＋語音增強）</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                  適合背景噪音明顯的錄音；乾淨的音檔不需要開啟。
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
