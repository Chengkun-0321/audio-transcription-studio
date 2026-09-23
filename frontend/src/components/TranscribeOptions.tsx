/**
 * 轉錄設定表單：語言（常用膠囊＋其他下拉）、三檔模式卡片（選中框彈簧滑動）、
 * 進階摺疊區（說話者識別／音訊修復，iOS 設定列樣式）。上傳彈窗與媒體詳細頁共用。
 */
import { motion } from "framer-motion";
import { useId, useState } from "react";
import {
  COMMON_LANGUAGES,
  MODE_INFO,
  OTHER_LANGUAGES,
  type ModeKey,
} from "../lib/format";
import { springBead } from "../lib/motion";
import { Select, Switch } from "./ui";

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
  const modeBeadId = useId();
  const [showOthers, setShowOthers] = useState(
    OTHER_LANGUAGES.some((l) => l.code === value.language),
  );
  const [showAdvanced, setShowAdvanced] = useState(value.diarization || value.denoise);

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

      {/* 三檔模式 */}
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-fg-muted">轉錄模式</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="轉錄模式">
          {(Object.keys(MODE_INFO) as ModeKey[]).map((m) => {
            const active = value.mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ ...value, mode: m })}
                className={`press relative flex cursor-pointer flex-col items-start gap-1 rounded-2xl p-3 text-left transition-colors ${
                  active ? "" : "bg-fg/[0.04] hover:bg-fg/[0.07]"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={`mode-${modeBeadId}`}
                    className="absolute inset-0 rounded-2xl bg-sonar-soft shadow-[inset_0_0_0_1.5px_var(--sonar),0_8px_24px_-12px_var(--sonar)]"
                    transition={springBead}
                  />
                )}
                <span className="relative flex w-full items-center justify-between">
                  <span className={`font-display text-sm font-semibold ${active ? "text-sonar" : ""}`}>
                    {MODE_INFO[m].name}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-4 w-4 ${active ? "text-sonar" : "text-fg-muted"}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d={MODE_GLYPHS[m]} />
                  </svg>
                </span>
                <span className="relative text-xs leading-snug text-fg-muted">{MODE_INFO[m].tagline}</span>
                <span className="relative font-mono text-[10px] text-fg-muted/70">{MODE_INFO[m].model}</span>
              </button>
            );
          })}
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
            className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-fg/[0.04]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          >
            <label className="flex cursor-pointer items-center gap-4 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">說話者識別</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                  標記每段話由誰說。此功能在本機以 CPU 運算，一小時音檔約需 10–20
                  分鐘，視發言人數與音檔品質而定。
                </span>
              </span>
              <Switch checked={value.diarization} onChange={(v) => onChange({ ...value, diarization: v })} />
            </label>
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
