/**
 * 媒體詳細頁：站內播放器 + 逐字稿 + 任務管理。
 * 功能：影音直接播放、點時間戳跳轉、播放跟隨高亮、逐字稿搜尋/複製、
 * 時間戳顯示開關（同步影響匯出）、TXT/SRT/DOCX 匯出、移至資料夾、
 * 標題點擊改名、重新轉錄、進行中任務進度與終止、任務歷史。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { fmtDate, fmtDuration, fmtTimestamp, jobStageLabel, langLabel, MODE_INFO, type ModeKey } from "../lib/format";
import type { Folder, Job, Media, Transcript } from "../lib/types";
import { CheckDraw, WaveformPulse } from "../components/sonar";
import { ConfirmDialog, ProgressBar } from "../components/ui";
import { DEFAULT_SETTINGS, TranscribeOptions, type TranscribeSettings } from "../components/TranscribeOptions";

const SPEAKER_COLORS = [
  "text-sonar",
  "text-amber",
  "text-[#7FB2F0]",
  "text-[#C792EA]",
  "text-[#E08FBE]",
  "text-[#9CCC65]",
];

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
            <Link to="/library" className="text-sm text-fg-muted transition-colors hover:text-sonar">
              ← 媒體庫
            </Link>
            <div className="mt-2 flex items-start justify-between gap-4">
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
                  className="w-full rounded-lg border border-sonar bg-surface px-3 py-1.5 font-display text-2xl font-bold outline-none"
                />
              ) : (
                <h1
                  className="cursor-text font-display text-2xl font-bold leading-tight hover:opacity-80"
                  title="點擊更名"
                  onClick={() => {
                    setTitleInput(media.title);
                    setEditingTitle(true);
                  }}
                >
                  {media.title}
                </h1>
              )}
              <button
                onClick={() => setConfirmDelete(true)}
                className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-danger/50 hover:text-danger"
              >
                刪除
              </button>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span className="font-mono">{fmtDuration(media.duration_seconds)}</span>
              <span>·</span>
              <span className="font-mono">{fmtDate(media.created_at)}</span>
              <span>·</span>
              <label className="flex items-center gap-1.5">
                <span>資料夾</span>
                <select
                  value={media.folder ?? ""}
                  onChange={(e) => moveToFolder(e.target.value || null)}
                  className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs outline-none focus:border-sonar"
                  title="移至資料夾"
                >
                  <option value="">未分類</option>
                  {folders.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              {media.source_url && (
                <>
                  <span>·</span>
                  <a href={media.source_url} target="_blank" rel="noreferrer" className="text-sonar hover:underline">
                    來源連結
                  </a>
                </>
              )}
            </p>
          </div>

          {/* 播放器：<1100px 黏在 header 下方（bg 遮住捲過的內容），影片保持完整可見 */}
          <div
            className={
              isVideo ? "sticky top-14 z-10 bg-ink min-[1100px]:top-[5.5rem] min-[1100px]:z-auto" : "contents"
            }
          >
            {fileReady ? (
              isVideo ? (
                <video
                  ref={(el) => {
                    playerRef.current = el;
                  }}
                  src={api.mediaFileUrl(media.id)}
                  controls
                  className="max-h-[min(420px,55svh)] w-full rounded-xl border border-line bg-black min-[1100px]:max-h-[min(680px,70svh)]"
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
              ) : (
                <audio
                  ref={(el) => {
                    playerRef.current = el;
                  }}
                  src={api.mediaFileUrl(media.id)}
                  controls
                  className="w-full"
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
              )
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-5 text-sm text-fg-muted">
                {activeJob ? <WaveformPulse size="sm" /> : null}
                {activeJob ? "媒體下載中，完成後即可播放…" : "媒體檔尚未就緒"}
              </div>
            )}

            {/* 播放速度：也可用鍵盤 , / . 微調。與播放器同綁一個 sticky 區塊，避免被逐字稿捲動蓋住 */}
            {fileReady && (
              <div
                ref={speedRef}
                className={`flex items-center gap-1.5 text-xs text-fg-muted ${isVideo ? "mt-2" : ""}`}
              >
                <span>速度</span>
                {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <button
                    key={r}
                    onClick={() => setPlaybackRate(r)}
                    className={`rounded-md border px-1.5 py-0.5 font-mono transition-colors ${
                      playbackRate === r
                        ? "border-sonar bg-sonar-soft text-sonar"
                        : "border-line hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 進行中任務 */}
          {activeJob && (
            <div className="rounded-xl border border-amber/40 bg-amber-soft p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-amber">
                  <WaveformPulse size="sm" />
                  {jobStageLabel(activeJob)}
                  {activeJob.type === "transcribe" && activeJob.mode
                    ? `（${MODE_INFO[activeJob.mode as ModeKey].name}模式）`
                    : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-xs text-amber">{activeJob.progress}%</span>
                  <button
                    onClick={() => cancelJob(activeJob.id)}
                    disabled={activeJob.cancel_requested}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
                  >
                    {activeJob.cancel_requested ? "終止中…" : "終止任務"}
                  </button>
                </span>
              </div>
              <ProgressBar value={activeJob.progress} processing />
            </div>
          )}
        </div>

        {/* 轉錄任務區 */}
        <div
          className={`rounded-xl border border-line bg-surface ${
            isVideo
              ? "flex min-h-0 flex-col min-[1100px]:sticky min-[1100px]:top-[5.5rem] min-[1100px]:max-h-[calc(100svh-7rem)]"
              : ""
          }`}
        >
          {/* 標頭固定兩列：標題＋主按鈕 / 搜尋與匯出控制，窄欄不會擠出孤行 */}
          <div className="border-b border-line px-5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-sm font-semibold">逐字稿</h2>
              {doneJobs.length > 1 && (
                <select
                  value={selectedJobId ?? ""}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-sonar"
                >
                  {doneJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {fmtDate(j.created_at)} · {MODE_INFO[(j.mode ?? "dolphin") as ModeKey].name}
                      {j.diarization ? " · 說話者" : ""}
                    </option>
                  ))}
                </select>
              )}
              {selectedJob && (
                <span className="text-xs text-fg-muted">
                  {langLabel(selectedJob.detected_language ?? selectedJob.language)}
                </span>
              )}
              <button
                onClick={() => setNewJobOpen((o) => !o)}
                disabled={!fileReady || !!activeJob}
                className="ml-auto rounded-lg bg-sonar px-3 py-1 text-xs font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {doneJobs.length > 0 ? "重新轉錄" : "開始轉錄"}
              </button>
            </div>
            {transcript && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜尋逐字稿…"
                  className="w-36 grow rounded-lg border border-line bg-ink px-2.5 py-1 text-xs outline-none focus:border-sonar"
                />
                <label
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted"
                  title="同時決定匯出檔案是否包含時間戳"
                >
                  <input
                    type="checkbox"
                    checked={showTs}
                    onChange={(e) => toggleTs(e.target.checked)}
                  />
                  時間戳
                </label>
                <button onClick={copyAll} className="rounded-lg border border-line px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg">
                  複製全文
                </button>
                {(["txt", "srt", "docx"] as const).map((f) => (
                  <a
                    key={f}
                    href={api.transcriptUrl(selectedJobId!, f, showTs)}
                    className="rounded-lg border border-line px-2.5 py-1 font-mono text-xs uppercase text-fg-muted transition-colors hover:border-sonar hover:text-sonar"
                  >
                    {f}
                  </a>
                ))}
              </div>
            )}
          </div>

          {newJobOpen && (
            <div className="border-b border-line px-5 py-4">
              <TranscribeOptions value={settings} onChange={setSettings} />
              <div className="mt-4 flex justify-end">
                <button onClick={startJob} className="rounded-lg bg-sonar px-4 py-2 text-sm font-medium text-ink hover:opacity-90">
                  開始轉錄
                </button>
              </div>
            </div>
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
                    className={`group flex gap-3 rounded-lg px-2 py-1.5 transition-colors ${
                      idx === activeSegIdx ? "bg-sonar-soft" : "hover:bg-surface-hover"
                    }`}
                  >
                    {showTs && (
                      <button
                        onClick={() => seekTo(seg.start)}
                        className="shrink-0 pt-0.5 font-mono text-xs text-fg-muted transition-colors hover:text-sonar"
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
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(seg.text);
                        toast("已複製", "success");
                      }}
                      className="shrink-0 self-start rounded p-1 text-fg-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                      title="複製此段"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 012-2h10" strokeLinecap="round" />
                      </svg>
                    </button>
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
        <details className="rounded-xl border border-line bg-surface px-5 py-3">
          <summary className="cursor-pointer text-sm text-fg-muted">
            任務歷史（{media.jobs.length}）
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 pb-1">
            {media.jobs.map((j: Job) => (
              <li key={j.id} className="flex items-center gap-3 text-xs text-fg-muted">
                <span className="font-mono">{fmtDate(j.created_at)}</span>
                <span>
                  {j.type === "download"
                    ? `下載 ${j.format?.toUpperCase() ?? ""}`
                    : `轉錄 · ${MODE_INFO[(j.mode ?? "dolphin") as ModeKey].name}${j.diarization ? " · 說話者" : ""}${j.denoise ? " · 修復" : ""}`}
                </span>
                {j.status === "done" ? (
                  <CheckDraw className="h-3 w-3" />
                ) : j.status === "cancelled" ? (
                  <span>已終止</span>
                ) : j.status === "error" ? (
                  <span className="text-danger" title={j.error_message ?? ""}>
                    失敗：{(j.error_message ?? "").slice(0, 60)}
                  </span>
                ) : (
                  <span className="text-amber">{j.progress}%</span>
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
