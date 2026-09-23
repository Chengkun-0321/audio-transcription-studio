/** 全站共用的 framer-motion 彈簧參數：所有動效同一套節奏（motion-consistency）。 */
import type { Transition } from "framer-motion";

/** 一般進場：彈窗、面板、卡片 */
export const spring: Transition = { type: "spring", visualDuration: 0.38, bounce: 0.18 };

/** 滑動指示器（導覽、分段控制）：稍快、帶一點液體回彈 */
export const springBead: Transition = { type: "spring", visualDuration: 0.34, bounce: 0.24 };

/** 退場：比進場短，不回彈（exit-faster-than-enter） */
export const exitFast: Transition = { duration: 0.16, ease: [0.4, 0, 1, 1] };
