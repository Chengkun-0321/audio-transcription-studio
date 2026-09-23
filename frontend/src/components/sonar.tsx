/** 深海聲納視覺元件：波形、脈動、ping、打勾（規格 §6 招牌動效） */
import { motion, useReducedMotion } from "framer-motion";

/** 檔案列表用的極簡靜態波形圖示 */
export function WaveformIcon({ className = "" }: { className?: string }) {
  const bars = [5, 11, 8, 14, 6, 12, 9, 4];
  return (
    <svg viewBox="0 0 32 16" className={className} aria-hidden>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 4 + 1}
          y={(16 - h) / 2}
          width={2}
          height={h}
          rx={1}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/** 招牌動畫：轉錄中的即時波形脈動（取代 spinner） */
export function WaveformPulse({ size = "md" }: { size?: "sm" | "md" }) {
  const reduced = useReducedMotion();
  const bars = size === "sm" ? 5 : 9;
  const h = size === "sm" ? 14 : 22;
  if (reduced) {
    // prefers-reduced-motion：退回靜態波形
    return <WaveformIcon className={`text-sonar ${size === "sm" ? "h-3.5 w-7" : "h-5 w-10"}`} />;
  }
  return (
    <div className="flex items-center gap-[3px]" style={{ height: h }} aria-label="處理中">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-sonar"
          animate={{ height: [h * 0.25, h * (0.5 + 0.5 * Math.sin(i * 1.7) ** 2), h * 0.3] }}
          transition={{
            duration: 0.9 + (i % 3) * 0.22,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "easeInOut",
            delay: i * 0.08,
          }}
        />
      ))}
    </div>
  );
}

/** 拖曳進上傳區時，由中心向外擴散的聲納 ping */
export function SonarPing({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  if (!active || reduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border-2 border-sonar"
          initial={{ width: 24, height: 24, opacity: 0.8 }}
          animate={{ width: 420, height: 420, opacity: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

/** 任務完成：一筆畫勾勒的打勾（stroke draw-in） */
export function CheckDraw({ className = "h-4 w-4" }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`text-sonar ${className}`} aria-label="完成">
      <motion.path
        d="M4 12.5 L10 18.5 L20 6"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
    </svg>
  );
}

/** 主題切換圖示：目前深色顯示月亮、淺色顯示太陽，一眼看出用途 */
export function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  );
}
