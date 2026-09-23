/**
 * 媒體詳細頁：站內播放器 + 逐字稿 + 任務管理。
 * 功能：影音直接播放、點時間戳跳轉、播放跟隨高亮、逐字稿搜尋/複製、
 * 時間戳顯示開關（同步影響匯出）、TXT/SRT/DOCX 匯出、移至資料夾、
 * 標題點擊改名、重新轉錄、進行中任務進度與終止、任務歷史。
 */
import { motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { fmtDate, fmtDuration, fmtTimestamp, jobStageLabel, langLabel, MODE_INFO, type ModeKey } from "../lib/format";
import type { Folder, Job, Media, Transcript } from "../lib/types";
import { CheckDraw, WaveformPulse } from "../components/sonar";
import { Button, ConfirmDialog, IconButton, ProgressBar, Segmented, Select, Switch } from "../components/ui";
import { DEFAULT_SETTINGS, TranscribeOptions, type TranscribeSettings } from "../components/TranscribeOptions";

// 說話者色走 token（index.css --spk-*），淺/深主題各有對比足夠的色值
const SPEAKER_COLORS = ["text-sonar", "text-amber", "text-spk-3", "text-spk-4", "text-spk-5", "text-spk-6"];

// 快捷鍵 , / . 可調到 0.5–2 之間任意 0.25 倍數；不在此列時分段控制不顯示選中，旁邊另外標示目前倍速
const PLAYBACK_RATES: string[] = ["0.75", "1", "1.25", "1.5", "2"];

export function MediaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast, activeJobs, jobsVersion, refreshJobs } = useApp();

  const [media, setMedia] = useState<Media | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [showTs, setShowTs] = useState(() => localStorage.getItem("transcript-ts") !== "off");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [search, setSearch] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [settings, setSettings] = useState<TranscribeSettings>(DEFAULT_SETTINGS);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [listMaxH, setListMaxH] = useState<number | null>(null);
  const [isWide, setIsWide] = useState(() => window.matchMedia("(min-width: 1100px)").matches);

  const playerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const speedRef = useRef<HTMLDivElement>(null);
  const segListRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lastSaveRef = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const m = await api.getMedia(id);
      setMedia(m);
      // 預選最新完成的轉錄任務
      const doneJobs = m.jobs.filter((j) => j.type === "transcribe" && j.status === "done");
      if (doneJobs.length > 0 && !selectedJobId) setSelectedJobId(doneJobs[0].id);
    } catch (e) {
      toast((e as Error).message, "error");
      navigate("/library");
    }
    // selectedJobId 僅在初次載入時預選，不需列入依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, toast, navigate]);

  useEffect(() => {
    load();
  }, [load, jobsVersion]);

  useEffect(() => {
    api.listFolders().then(setFolders).catch(() => {});
  }, []);

  /** 時間戳開關：控制逐字稿顯示與匯出格式，選擇存 localStorage。 */
  const toggleTs = (v: boolean) => {
    setShowTs(v);
    localStorage.setItem("transcript-ts", v ? "on" : "off");
  };

  useEffect(() => {
    if (!selectedJobId) return setTranscript(null);
    api.getSegments(selectedJobId).then(setTranscript).catch(() => setTranscript(null));
  }, [selectedJobId]);

  const activeJob = activeJobs.find((j) => j.media_id === id);
  const doneJobs = useMemo(
    () => media?.jobs.filter((j) => j.type === "transcribe" && j.status === "done") ?? [],
    [media],
  );
  const selectedJob = media?.jobs.find((j) => j.id === selectedJobId) ?? null;

  /* ≥1100px 雙欄與否：影響逐字稿列表高度的套用方式（雙欄由 sticky 卡片的 flex 控高） */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1100px)");
    const onChange = () => setIsWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* 逐字稿列表高度自適應：底邊貼齊視窗下緣，句子都在列表內部捲動，
     播放跟隨就不需捲動整頁、播放器不會被擠出畫面 */
  useLayoutEffect(() => {
    const compute = () => {
      const el = segListRef.current;
      if (!el) return;
      // 以文件座標取列表上緣，與當前捲動位置無關，避免 maxHeight 變動引發回饋循環
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      setListMaxH(Math.max(200, window.innerHeight - docTop - 16));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
    // activeJob 每次輪詢都是新物件，但 compute 結果相同時 setState 不會觸發重渲染
  }, [transcript, activeJob, newJobOpen, media]);

  /* 播放跟隨：目前段落高亮並捲動至可視範圍 */
  const activeSegIdx = useMemo(() => {
    if (!transcript) return -1;
    return transcript.segments.findIndex((s) => currentTime >= s.start && currentTime < s.end);
  }, [transcript, currentTime]);

  useEffect(() => {
    if (activeSegIdx < 0 || !followRef.current || !segListRef.current) return;
    const container = segListRef.current;
    const el = container.querySelector<HTMLElement>(`[data-seg="${activeSegIdx}"]`);
    if (!el) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    let top: number | null = null;

    if (elRect.top < containerRect.top) {
      top = container.scrollTop + elRect.top - containerRect.top;
    } else if (elRect.bottom > containerRect.bottom) {
      top = container.scrollTop + elRect.bottom - containerRect.bottom;
    }

    if (top !== null) container.scrollTo({ top, behavior: "smooth" });

    // 視窗層跟隨（僅 <1100px 單欄）：列表容器可能低於視窗，把頁面也捲到當前句可見。
    // ≥1100px 雙欄卡片 sticky 恆在視窗內，捲頁反而會干擾，直接跳過。
    if (window.matchMedia("(min-width: 1100px)").matches) return;
    const listDelta = top !== null ? top - container.scrollTop : 0;
    const finalTop = elRect.top - listDelta;
    const finalBottom = elRect.bottom - listDelta;
    // 上界取「黏著播放器（含速度列）下緣」：單欄時影片蓋在內容上方，當前句要落在其下才看得到
    const coverBottom = (speedRef.current ?? playerRef.current)?.getBoundingClientRect().bottom ?? 0;
    const upperBound = Math.max(72, coverBottom + 8);
    const lowerBound = window.innerHeight - 16;
    if (finalBottom > lowerBound) {
      window.scrollBy({ top: finalBottom - lowerBound, behavior: "smooth" });
    } else if (finalTop < upperBound) {
      window.scrollBy({ top: finalTop - upperBound, behavior: "smooth" });
    }
  }, [activeSegIdx]);

  /* <1100px 單欄：播放器黏住 header 時才顯示毛玻璃底，未黏住時與頁面背景融為一體 */
  const stickyRef = useRef<HTMLDivElement>(null);
  const [playerStuck, setPlayerStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const el = stickyRef.current;
      // top-14 = 56px；≥1100px 時 sticky 在 5.5rem，永遠不會 <= 57，自然不觸發
      setPlayerStuck(!!el && window.scrollY > 0 && el.getBoundingClientRect().top <= 57);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [media?.media_kind]);

  const seekTo = (t: number) => {
    followRef.current = true;
    if (playerRef.current) {
      playerRef.current.currentTime = t;
      playerRef.current.play().catch(() => {});
    }
  };

  const togglePlay = () => {
    const el = playerRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  const seekBy = (delta: number) => {
    const el = playerRef.current;
    if (!el) return;
    followRef.current = true;
    el.currentTime = Math.max(0, el.currentTime + delta); // 上界瀏覽器原生會 clamp 到 duration
  };

  /** 跳至前一句/後一句開頭；dir 為 1 時往後、-1 時往前。 */
  const jumpSegment = (dir: 1 | -1) => {
    if (!transcript || transcript.segments.length === 0) return;
    const segs = transcript.segments;
    if (dir > 0) {
      const next = segs.findIndex((s) => s.start > currentTime + 0.15);
      if (next >= 0) seekTo(segs[next].start);
      return;
    }
    const refStart = activeSegIdx >= 0 ? segs[activeSegIdx].start : currentTime;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].start < refStart - 0.15) {
        seekTo(segs[i].start);
        return;
      }
    }
  };

  const setPlaybackRate = (r: number) => {
    const clamped = Math.min(2, Math.max(0.5, Math.round(r * 100) / 100));
    setPlaybackRateState(clamped);
    if (playerRef.current) playerRef.current.playbackRate = clamped;
  };

  /** 播放器 <video>/<audio> 掛載完成：套用播放速度，並跳回上次播放位置。 */
  const handleLoadedMetadata = (el: HTMLVideoElement | HTMLAudioElement) => {
    el.playbackRate = playbackRate;
    if (!media) return;
    const saved = Number(localStorage.getItem(`playback-pos-${media.id}`));
    if (saved > 0 && saved < el.duration - 1) el.currentTime = saved;
  };

  /** 節流寫入播放進度到 localStorage（>5 秒差才寫一次）。 */
  const savePlaybackPos = (t: number) => {
    if (!media) return;
    if (Math.abs(t - lastSaveRef.current) < 5) return;
    lastSaveRef.current = t;
    localStorage.setItem(`playback-pos-${media.id}`, String(t));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(10);
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-10);
          break;
        case "ArrowUp":
          e.preventDefault();
          jumpSegment(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          jumpSegment(1);
          break;
        case ",":
          setPlaybackRate(playbackRate - 0.25);
          break;
        case ".":
          setPlaybackRate(playbackRate + 0.25);
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [playbackRate, transcript, currentTime, activeSegIdx]);

  const speakerColor = useMemo(() => {
    const map = new Map<string, string>();
    transcript?.segments.forEach((s) => {
      if (s.speaker && !map.has(s.speaker)) {
        map.set(s.speaker, SPEAKER_COLORS[map.size % SPEAKER_COLORS.length]);
      }
    });
    return map;
  }, [transcript]);

  const shownSegments = useMemo(() => {
    if (!transcript) return [];
    if (!search.trim()) return transcript.segments.map((s, i) => ({ seg: s, idx: i }));
    const q = search.trim().toLowerCase();
    return transcript.segments
      .map((s, i) => ({ seg: s, idx: i }))
      .filter(({ seg }) => seg.text.toLowerCase().includes(q));
  }, [transcript, search]);

  const saveTitle = async () => {
    setEditingTitle(false);
    const t = titleInput.trim();
    if (!media || !t || t === media.title) return;
    try {
      setMedia(await api.renameMedia(media.id, t));
      toast("已更名", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const startJob = async () => {
    if (!media) return;
    try {
      const job = await api.createJob({ media_id: media.id, ...settings });
      setNewJobOpen(false);
      refreshJobs();
      toast(`已開始${MODE_INFO[settings.mode].name}模式轉錄`, "success");
      setSelectedJobId(job.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  /** 終止進行中的任務。 */
  const cancelJob = async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      refreshJobs();
      toast("已送出終止請求，任務將在數秒內停止", "info");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  /** 移動此媒體到指定資料夾（null = 未分類）。 */
  const moveToFolder = async (folder: string | null) => {
    if (!media) return;
    try {
      setMedia(await api.moveMedia(media.id, folder));
      toast(`已移至「${folder ?? "未分類"}」`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  /** 複製全文：規則與匯出一致（時間戳關閉且無說話者時文字接在一起）。 */
  const copyAll = async () => {
    if (!transcript) return;
    const hasSpeaker = transcript.segments.some((s) => s.speaker);
    let text: string;
    if (showTs || hasSpeaker) {
      text = transcript.segments
        .map((s) => {
          const ts = showTs ? `[${fmtTimestamp(s.start)}] ` : "";
          return s.speaker ? `${ts}${s.speaker}: ${s.text}` : `${ts}${s.text}`;
        })
        .join("\n");
    } else {
      // 時間戳關閉且無說話者：文字接在一起（zh/ja/ko 不加分隔）
      const join = /^(zh|ja|ko)/.test(transcript.language ?? "") ? "" : " ";
      text = transcript.segments.map((s) => s.text).join(join);
    }
    await navigator.clipboard.writeText(text);
    toast("已複製全文", "success");
  };

  if (!media) return null;
  const fileReady = media.ext !== null;
  const isVideo = media.media_kind === "video";

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 ${isVideo ? "max-w-4xl min-[1100px]:max-w-[1600px]" : "max-w-4xl"}`}
      onWheel={() => {
        // 手動捲頁即暫停跟隨；點時間戳或重新播放（seekTo / onPlay）會恢復
        followRef.current = false;
      }}
    >
      {/* 影片時 ≥1100px 為「(標題＋播放器)｜逐字稿」雙欄，其餘維持單欄正常流 */}
      <div
        className={
          isVideo
            ? "grid gap-6 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] min-[1100px]:items-start"
            : "contents"
        }
      >
        {/* 左欄：標題列＋播放器＋進行中任務（<1100px 展平，讓播放器能在整個 grid 範圍內黏著） */}
        <div
          className={
            isVideo
              ? "contents min-[1100px]:flex min-[1100px]:min-w-0 min-[1100px]:flex-col min-[1100px]:gap-6"
              : "contents"
          }
        >
          {/* 標題列 */}
          <div>
            <Link
              to="/library"
              className="press glass relative inline-flex h-8 items-center gap-1 rounded-full pl-2 pr-3.5 text-sm text-fg-muted hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              媒體庫
            </Link>
            <div className="mt-4 flex items-start justify-between gap-4">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  aria-label="新標題"
                  className="field w-full rounded-2xl px-3.5 py-1.5 font-display text-2xl font-semibold md:text-3xl"
                />
              ) : (
                <h1
                  className="cursor-text font-display text-2xl font-semibold leading-tight tracking-tight transition-opacity hover:opacity-80 md:text-3xl"
                  title="點擊更名"
                  onClick={() => {
                    setTitleInput(media.title);
                    setEditingTitle(true);
                  }}
                >
                  {media.title}
                </h1>
              )}
              <Button variant="glass-danger" size="sm" onClick={() => setConfirmDelete(true)} className="mt-0.5">
                刪除
              </Button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span className="font-mono tabular-nums">{fmtDuration(media.duration_seconds)}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">{fmtDate(media.created_at)}</span>
              <span aria-hidden>·</span>
              <label className="flex items-center gap-1.5">
                <span>資料夾</span>
                <Select
                  size="sm"
                  value={media.folder ?? ""}
                  onChange={(e) => moveToFolder(e.target.value || null)}
                  title="移至資料夾"
                >
                  <option value="">未分類</option>
                  {folders.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </label>
              {media.source_url && (
                <>
                  <span aria-hidden>·</span>
                  <a href={media.source_url} target="_blank" rel="noreferrer" className="text-sonar hover:underline">
                    來源連結
                  </a>
                </>
              )}
            </div>
          </div>

          {/* 播放器：<1100px 黏在 header 下方（毛玻璃底遮住捲過的內容，負邊距延伸到頁緣），影片保持完整可見 */}
          <div
            ref={stickyRef}
            className={
              isVideo
                ? `sticky top-14 z-10 -mx-3 rounded-b-3xl px-3 pb-2 pt-1 transition-[background-color,backdrop-filter] duration-300 md:-mx-5 md:px-5 min-[1100px]:top-[5.5rem] min-[1100px]:z-auto min-[1100px]:mx-0 min-[1100px]:p-0 ${
                    playerStuck ? "bg-ink/75 backdrop-blur-xl" : ""
                  }`
                : "contents"
            }
          >
            {fileReady ? (
              isVideo ? (
                <div className="glass-card relative rounded-[22px] p-1.5">
                  <video
                    ref={(el) => {
                      playerRef.current = el;
                    }}
                    src={api.mediaFileUrl(media.id)}
                    controls
                    className="block max-h-[min(420px,55svh)] w-full rounded-2xl bg-black min-[1100px]:max-h-[min(680px,70svh)]"
                    onLoadedMetadata={(e) => handleLoadedMetadata(e.currentTarget)}
                    onTimeUpdate={(e) => {
                      setCurrentTime(e.currentTarget.currentTime);
                      savePlaybackPos(e.currentTarget.currentTime);
                    }}
                    onPause={(e) => savePlaybackPos(e.currentTarget.currentTime)}
                    onPlay={() => {
                      followRef.current = true;
                    }}
                  />
                </div>
              ) : (
                <div className="glass-card relative rounded-[28px] p-2">
                  <audio
                    ref={(el) => {
                      playerRef.current = el;
                    }}
                    src={api.mediaFileUrl(media.id)}
                    controls
                    className="block w-full"
                    onLoadedMetadata={(e) => handleLoadedMetadata(e.currentTarget)}
                    onTimeUpdate={(e) => {
                      setCurrentTime(e.currentTarget.currentTime);
                      savePlaybackPos(e.currentTarget.currentTime);
                    }}
                    onPause={(e) => savePlaybackPos(e.currentTarget.currentTime)}
                    onPlay={() => {
                      followRef.current = true;
                    }}
                  />
                </div>
              )
            ) : (
              <div className="glass-card relative flex items-center gap-3 rounded-3xl p-5 text-sm text-fg-muted">
                {activeJob ? <WaveformPulse size="sm" /> : null}
                {activeJob ? "媒體下載中，完成後即可播放…" : "媒體檔尚未就緒"}
              </div>
            )}

            {/* 播放速度：也可用鍵盤 , / . 微調。與播放器同綁一個 sticky 區塊，避免被逐字稿捲動蓋住 */}
            {fileReady && (
              <div ref={speedRef} className={`flex items-center gap-2 text-xs text-fg-muted ${isVideo ? "mt-2" : ""}`}>
                <span>速度</span>
                <Segmented<string>
                  size="sm"
                  label="播放速度"
                  value={String(playbackRate)}
                  onChange={(v) => setPlaybackRate(Number(v))}
                  options={PLAYBACK_RATES.map((r) => ({ value: r, label: <span className="font-mono">{r}x</span> }))}
                />
                {!PLAYBACK_RATES.includes(String(playbackRate)) && (
                  <span className="font-mono text-sonar">{playbackRate}x</span>
                )}
              </div>
            )}
          </div>

          {/* 進行中任務 */}
          {activeJob && (
            <div className="glass-card relative rounded-3xl p-4 outline-1 -outline-offset-1 outline-amber/35">
              <div className="mb-2.5 flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-amber">
                  <WaveformPulse size="sm" />
                  {jobStageLabel(activeJob)}
                  {activeJob.type === "transcribe" && activeJob.mode
                    ? `（${MODE_INFO[activeJob.mode as ModeKey].name}模式）`
                    : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-amber">{activeJob.progress}%</span>
                  <Button
                    variant="glass-danger"
                    size="sm"
                    onClick={() => cancelJob(activeJob.id)}
                    disabled={activeJob.cancel_requested}
                  >
                    {activeJob.cancel_requested ? "終止中…" : "終止任務"}
                  </Button>
                </span>
              </div>
              <ProgressBar value={activeJob.progress} processing />
            </div>
          )}
        </div>

        {/* 轉錄任務區 */}
        <div
          className={`glass-card relative rounded-3xl ${
            isVideo
              ? "flex min-h-0 flex-col min-[1100px]:sticky min-[1100px]:top-[5.5rem] min-[1100px]:max-h-[calc(100svh-7rem)]"
              : ""
          }`}
        >
          {/* 標頭固定兩列：標題＋主按鈕 / 搜尋與匯出控制，窄欄不會擠出孤行 */}
          <div className="border-b border-line px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-[15px] font-semibold">逐字稿</h2>
              {doneJobs.length > 1 && (
                <Select
                  size="sm"
                  aria-label="選擇轉錄版本"
                  value={selectedJobId ?? ""}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                >
                  {doneJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {fmtDate(j.created_at)} · {MODE_INFO[(j.mode ?? "dolphin") as ModeKey].name}
                      {j.diarization ? " · 說話者" : ""}
                    </option>
                  ))}
                </Select>
              )}
              {selectedJob && (
                <span className="rounded-full bg-fg/[0.06] px-2.5 py-0.5 text-xs text-fg-muted">
                  {langLabel(selectedJob.detected_language ?? selectedJob.language)}
                </span>
              )}
              <Button
                variant="primary"
                size="sm"
                className="ml-auto"
                onClick={() => setNewJobOpen((o) => !o)}
                disabled={!fileReady || !!activeJob}
                aria-expanded={newJobOpen}
              >
                {doneJobs.length > 0 ? "重新轉錄" : "開始轉錄"}
              </Button>
            </div>
            {transcript && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="relative w-36 grow">
                  <span className="sr-only">搜尋逐字稿</span>
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜尋逐字稿…"
                    className="field h-8 w-full rounded-full pl-8 pr-3 text-xs placeholder:text-fg-muted/60"
                  />
                </label>
                <label
                  className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted"
                  title="同時決定匯出檔案是否包含時間戳"
                >
                  <Switch checked={showTs} onChange={toggleTs} />
                  時間戳
                </label>
                <Button variant="glass" size="sm" onClick={copyAll}>
                  複製全文
                </Button>
                <div className="field inline-flex h-8 items-center rounded-full p-0.5" role="group" aria-label="匯出逐字稿">
                  <span className="pl-2 pr-1 text-[11px] text-fg-muted">匯出</span>
                  {(["txt", "srt", "docx"] as const).map((f) => (
                    <a
                      key={f}
                      href={api.transcriptUrl(selectedJobId!, f, showTs)}
                      className="press flex h-7 items-center rounded-full px-2.5 font-mono text-[11px] uppercase text-fg-muted hover:bg-[var(--bead-bg)] hover:text-sonar hover:shadow-[var(--bead-shadow)]"
                    >
                      {f}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 只做進場動畫：listMaxH 在 newJobOpen 變動當下量測，若面板延遲卸載會量錯列表高度 */}
          {newJobOpen && (
            <motion.div
              className="border-b border-line px-5 py-4"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            >
              <TranscribeOptions value={settings} onChange={setSettings} />
              <div className="mt-4 flex justify-end">
                <Button variant="primary" onClick={startJob}>
                  開始轉錄
                </Button>
              </div>
            </motion.div>
          )}

          {/* 逐字稿內容 */}
          {transcript ? (
            transcript.segments.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-fg-muted">未偵測到語音內容</p>
            ) : (
              <div
                ref={segListRef}
                className={`overflow-y-auto px-5 py-4 ${
                  isVideo ? "min-[1100px]:min-h-0 min-[1100px]:flex-1" : ""
                }`}
                // 雙欄影片由 sticky 卡片 flex 控高，不套量測值；其餘情境用視窗自適應高度
                style={isVideo && isWide ? undefined : { maxHeight: listMaxH ?? 480 }}
                onWheel={() => {
                  followRef.current = false;
                }}
                onMouseLeave={() => {
                  followRef.current = true;
                }}
              >
                {shownSegments.map(({ seg, idx }) => (
                  <div
                    key={idx}
                    data-seg={idx}
                    className={`group flex gap-3 rounded-xl px-2.5 py-1.5 transition-colors ${
                      idx === activeSegIdx ? "bg-sonar-soft shadow-[inset_2px_0_0_var(--sonar)]" : "hover:bg-fg/[0.04]"
                    }`}
                  >
                    {showTs && (
                      <button
                        onClick={() => seekTo(seg.start)}
                        className="shrink-0 cursor-pointer pt-0.5 font-mono text-xs tabular-nums text-fg-muted transition-colors hover:text-sonar"
                        title="跳到此處播放"
                      >
                        {fmtTimestamp(seg.start)}
                      </button>
                    )}
                    {seg.speaker && (
                      <span className={`shrink-0 pt-0.5 font-mono text-xs font-semibold ${speakerColor.get(seg.speaker)}`}>
                        {seg.speaker}
                      </span>
                    )}
                    <p
                      onClick={() => {
                        if (window.getSelection()?.toString()) return; // 反白選字複製時不搶跳轉
                        seekTo(seg.start);
                      }}
                      title="點擊跳到此處播放"
                      className="min-w-0 flex-1 cursor-pointer text-sm leading-relaxed transition-colors hover:text-sonar"
                    >
                      {search.trim() ? highlight(seg.text, search.trim()) : seg.text}
                    </p>
                    <IconButton
                      label="複製此段"
                      size="sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(seg.text);
                        toast("已複製", "success");
                      }}
                      // -my-1：按鈕 28px 比單行文字高，負邊距避免撐高每一列
                      className="-my-1 self-start opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 012-2h10" strokeLinecap="round" />
                      </svg>
                    </IconButton>
                  </div>
                ))}
                {search.trim() && shownSegments.length === 0 && (
                  <p className="py-8 text-center text-sm text-fg-muted">找不到「{search}」</p>
                )}
              </div>
            )
          ) : doneJobs.length === 0 && !activeJob ? (
            <p className="px-5 py-10 text-center text-sm text-fg-muted">
              尚未轉錄。點右上「開始轉錄」，選擇模式與語言。
            </p>
          ) : null}
        </div>
      </div>

      {/* 歷史任務 */}
      {media.jobs.length > 0 && (
        <details className="glass-card group/hist relative rounded-3xl px-5 py-3.5">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 transition-transform duration-300 ease-[var(--ease-spring)] group-open/hist:rotate-90"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
            任務歷史（{media.jobs.length}）
          </summary>
          <ul className="mt-3 flex flex-col gap-2 pb-1">
            {media.jobs.map((j: Job) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span className="font-mono">{fmtDate(j.created_at)}</span>
                <span>
                  {j.type === "download"
                    ? `下載 ${j.format?.toUpperCase() ?? ""}`
                    : `轉錄 · ${MODE_INFO[(j.mode ?? "dolphin") as ModeKey].name}${j.diarization ? " · 說話者" : ""}${j.denoise ? " · 修復" : ""}`}
                </span>
                {j.status === "done" ? (
                  <span className="flex items-center gap-1 rounded-full bg-sonar-soft px-2 py-0.5 text-sonar">
                    <CheckDraw className="h-3 w-3" /> 完成
                  </span>
                ) : j.status === "cancelled" ? (
                  <span className="rounded-full bg-fg/[0.06] px-2 py-0.5">已終止</span>
                ) : j.status === "error" ? (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-danger" title={j.error_message ?? ""}>
                    失敗：{(j.error_message ?? "").slice(0, 60)}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-soft px-2 py-0.5 font-mono text-amber">{j.progress}%</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="刪除檔案"
        message="會一併刪除原始媒體與所有轉錄結果，無法復原。"
        onConfirm={async () => {
          try {
            await api.deleteMedia(media.id);
            toast("已刪除", "success");
            navigate("/library");
          } catch (e) {
            toast((e as Error).message, "error");
          }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** 搜尋關鍵字高亮：把命中的片段包 <mark>（大小寫不敏感）。 */
function highlight(text: string, q: string) {
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="rounded bg-amber-soft px-0.5 text-amber">
        {p}
      </mark>
    ) : (
      p
    ),
  );
}
