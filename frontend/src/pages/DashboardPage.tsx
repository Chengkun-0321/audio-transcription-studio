/**
 * 媒體庫（儀表板）：資料夾側欄 + 媒體列表。
 * 功能：搜尋、排序、多選批次移動/刪除、拖曳歸檔（拖列到側欄資料夾）、
 * 單檔移至資料夾下拉、單檔就地改名、進行中任務即時進度與終止、上傳彈窗。
 */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { fmtDate, fmtDuration, jobStageLabel } from "../lib/format";
import { exitFast, spring, springBead } from "../lib/motion";
import type { Folder, Media } from "../lib/types";
import { CheckDraw, WaveformIcon } from "../components/sonar";
import { Button, Checkbox, ConfirmDialog, EmptyState, IconButton, ProgressBar, Select } from "../components/ui";
import { UploadModal } from "../components/UploadModal";

type SortKey = "created" | "duration" | "title";

export function DashboardPage() {
  const { toast, activeJobs, jobsVersion, refreshJobs } = useApp();
  const [media, setMedia] = useState<Media[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null); // null=全部, "inbox"=未分類
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("created");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState("");
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const skipBlurSaveRef = useRef(false); // Esc 取消後，輸入框卸載觸發的 blur 不要存檔

  const load = useCallback(async () => {
    try {
      const [m, f] = await Promise.all([api.listMedia(currentFolder), api.listFolders()]);
      setMedia(m);
      setFolders(f);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [currentFolder, toast]);

  useEffect(() => {
    load();
  }, [load, jobsVersion]);

  const shown = useMemo(() => {
    let list = media;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) => m.title.toLowerCase().includes(q) || m.original_filename.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      if (sort === "duration") return (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0);
      if (sort === "title") return a.title.localeCompare(b.title, "zh-Hant");
      return b.created_at.localeCompare(a.created_at);
    });
  }, [media, search, sort]);

  const jobFor = (m: Media) => activeJobs.find((j) => j.media_id === m.id);

  /* ---- 資料夾操作 ---- */

  /** 建立或改名資料夾（共用同一個輸入框，renamingFolder 決定行為）。 */
  const submitFolder = async () => {
    const name = folderInput.trim();
    if (!name) return setNewFolderMode(false);
    try {
      if (renamingFolder) {
        await api.renameFolder(renamingFolder, name);
        if (currentFolder === renamingFolder) setCurrentFolder(name);
      } else {
        await api.createFolder(name);
      }
      setFolderInput("");
      setNewFolderMode(false);
      setRenamingFolder(null);
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const deleteFolder = (name: string) =>
    setConfirm({
      title: `刪除資料夾「${name}」`,
      message: "資料夾內的檔案會移回「未分類」，不會被刪除。",
      run: async () => {
        try {
          await api.deleteFolder(name);
          if (currentFolder === name) setCurrentFolder(null);
          load();
          toast("資料夾已刪除，檔案移回未分類", "success");
        } catch (e) {
          toast((e as Error).message, "error");
        }
      },
    });

  /* ---- 媒體操作 ---- */

  /** 移動一或多個媒體到指定資料夾（null = 未分類）。 */
  const moveTo = async (ids: string[], folder: string | null) => {
    try {
      await Promise.all(ids.map((id) => api.moveMedia(id, folder)));
      setSelected(new Set());
      load();
      toast(`已移至「${folder ?? "未分類"}」`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const startRename = (m: Media) => {
    skipBlurSaveRef.current = false;
    setTitleInput(m.title);
    setEditingId(m.id);
  };

  /** 儲存改名（只改顯示標題，不動實體檔名）。Enter 以 blur 觸發，避免重複送出。 */
  const saveTitle = async (m: Media) => {
    setEditingId(null);
    if (skipBlurSaveRef.current) return;
    skipBlurSaveRef.current = true;
    const t = titleInput.trim();
    if (!t || t === m.title) return;
    try {
      const updated = await api.renameMedia(m.id, t);
      setMedia((p) => p.map((x) => (x.id === m.id ? updated : x)));
      toast("已更名", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  /** 終止進行中的任務（協作式取消，worker 數秒內停止）。 */
  const cancelJob = async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      refreshJobs();
      toast("已送出終止請求，任務將在數秒內停止", "info");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const deleteMedia = (ids: string[]) =>
    setConfirm({
      title: ids.length > 1 ? `刪除 ${ids.length} 個檔案` : "刪除檔案",
      message: "會一併刪除原始媒體與所有轉錄結果，無法復原。",
      run: async () => {
        try {
          await Promise.all(ids.map((id) => api.deleteMedia(id)));
          setSelected(new Set());
          load();
          refreshJobs();
          toast("已刪除", "success");
        } catch (e) {
          toast((e as Error).message, "error");
        }
      },
    });

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /* ---- 拖曳歸檔 ---- */
  const onRowDragStart = (e: React.DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("text/media-ids", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  const onFolderDrop = (e: React.DragEvent, folder: string | null) => {
    e.preventDefault();
    setDragOverFolder(null);
    const data = e.dataTransfer.getData("text/media-ids");
    if (data) moveTo(JSON.parse(data), folder);
  };

  const folderTargets: { key: string | null; label: string; count?: number }[] = [
    { key: null, label: "全部檔案" },
    { key: "inbox", label: "未分類" },
    ...folders.map((f) => ({ key: f.name, label: f.name, count: f.media_count })),
  ];

  /** 列尾動作鈕：桌機 hover / 鍵盤聚焦時才顯示，手機常駐 */
  const rowAction = "transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:flex-row md:gap-8">
      {/* 側欄：手機為橫向捲動 chips 列，md 以上為玻璃面板直向清單 */}
      <aside className="w-full shrink-0 md:w-56">
        <div className="md:glass-card md:sticky md:top-20 md:rounded-3xl md:p-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:block md:overflow-visible md:pb-0">
            <ul className="flex gap-1.5 md:flex-col md:gap-0.5">
              {folderTargets.map((f) => {
                const active = currentFolder === f.key;
                const editable = f.key !== null && f.key !== "inbox";
                return (
                  <li key={f.key ?? "__all__"} className="group relative shrink-0">
                    <button
                      onClick={() => setCurrentFolder(f.key)}
                      onDragOver={(e) => {
                        if (f.key !== null) {
                          e.preventDefault();
                          setDragOverFolder(f.key);
                        }
                      }}
                      onDragLeave={() => setDragOverFolder(null)}
                      onDrop={(e) => f.key !== null && onFolderDrop(e, f.key === "inbox" ? null : f.key)}
                      aria-current={active ? "true" : undefined}
                      className={`press relative flex h-9 w-full cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-full px-3.5 text-sm transition-colors md:h-10 md:rounded-2xl ${
                        active
                          ? "font-medium text-fg"
                          : "text-fg-muted hover:text-fg max-md:bg-fg/[0.05] md:hover:bg-fg/[0.05]"
                      } ${f.key !== null && dragOverFolder === f.key ? "ring-2 ring-sonar" : ""}`}
                    >
                      {active && (
                        <motion.span
                          layoutId="folder-bead"
                          className="bead absolute inset-0 rounded-[inherit]"
                          transition={springBead}
                        />
                      )}
                      <span className="relative flex min-w-0 items-center gap-2">
                        <FolderGlyph kind={f.key === null ? "all" : f.key === "inbox" ? "inbox" : "folder"} active={active} />
                        <span className="truncate">{f.label}</span>
                      </span>
                      {f.count != null && (
                        <span
                          className={`relative font-mono text-xs tabular-nums opacity-60 ${
                            editable ? "group-hover:opacity-0 group-has-[:focus-visible]:opacity-0" : ""
                          }`}
                        >
                          {f.count}
                        </span>
                      )}
                    </button>
                    {editable && (
                      <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-[var(--glass-solid)] shadow-[var(--bead-shadow)] group-hover:flex group-has-[:focus-visible]:flex">
                        <IconButton
                          label="重新命名"
                          tone="accent"
                          size="sm"
                          onClick={() => {
                            setRenamingFolder(f.key);
                            setFolderInput(f.key!);
                            setNewFolderMode(true);
                          }}
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </IconButton>
                        <IconButton label="刪除資料夾" tone="danger" size="sm" onClick={() => deleteFolder(f.key!)}>
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </IconButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="shrink-0 md:mt-1.5 md:border-t md:border-line md:pt-1.5">
              {newFolderMode ? (
                <input
                  autoFocus
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitFolder();
                    if (e.key === "Escape") {
                      setNewFolderMode(false);
                      setRenamingFolder(null);
                    }
                  }}
                  onBlur={submitFolder}
                  placeholder={renamingFolder ? "新名稱" : "資料夾名稱"}
                  aria-label={renamingFolder ? "資料夾新名稱" : "新資料夾名稱"}
                  className="field h-9 w-40 rounded-full px-3.5 text-sm md:h-10 md:w-full md:rounded-2xl"
                />
              ) : (
                <button
                  onClick={() => {
                    setFolderInput("");
                    setRenamingFolder(null);
                    setNewFolderMode(true);
                  }}
                  className="press flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm text-fg-muted hover:bg-fg/[0.05] hover:text-fg md:h-10 md:w-full md:rounded-2xl"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  新增資料夾
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* 主列表 */}
      <section className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="relative min-w-48 flex-1">
            <span className="sr-only">搜尋檔名</span>
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋檔名…"
              className="field h-10 w-full rounded-full pl-10 pr-4 text-sm placeholder:text-fg-muted/60"
            />
          </label>
          <Select aria-label="排序方式" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="created">最新在前</option>
            <option value="duration">時長最長</option>
            <option value="title">名稱排序</option>
          </Select>
          <Button variant="primary" onClick={() => setUploadOpen(true)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            上傳檔案
          </Button>
        </div>

        <AnimatePresence>
          {selected.size > 0 && (
            <motion.div
              className="glass-strong sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2.5 rounded-3xl py-1.5 pl-4 pr-1.5 text-sm sm:rounded-full"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
              exit={{ opacity: 0, y: -6, transition: exitFast }}
            >
              <span>
                <span className="font-mono tabular-nums">{selected.size}</span> 個已選取
              </span>
              <Select
                size="sm"
                aria-label="移至資料夾"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value !== "") moveTo([...selected], e.target.value === "__inbox__" ? null : e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  移至資料夾…
                </option>
                <option value="__inbox__">未分類</option>
                {folders.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <Button variant="glass-danger" size="sm" onClick={() => deleteMedia([...selected])}>
                刪除
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
                取消選取
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {shown.length === 0 ? (
          <EmptyState
            title={search ? "沒有符合搜尋的檔案" : "這裡還很安靜"}
            hint={search ? undefined : "上傳音訊或影片，或到下載器貼上 YouTube 網址。"}
            action={
              !search ? (
                <Button variant="primary" onClick={() => setUploadOpen(true)} className="mt-2">
                  上傳第一個檔案
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="glass-card relative overflow-hidden rounded-3xl">
            {shown.map((m, i) => {
              const job = jobFor(m);
              const checked = selected.has(m.id);
              return (
                <li
                  key={m.id}
                  draggable={editingId !== m.id}
                  onDragStart={(e) => onRowDragStart(e, m.id)}
                  style={{ "--i": i } as CSSProperties}
                  className="rise-in group flex items-center gap-2.5 border-b border-line/70 px-3 py-3 transition-colors last:border-b-0 hover:bg-fg/[0.035] md:gap-3 md:px-4"
                >
                  <Checkbox
                    checked={checked}
                    onChange={() => toggleSelect(m.id)}
                    label={`選取「${m.title}」`}
                    className={checked || selected.size > 0 ? "" : rowAction}
                  />
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sonar-soft text-sonar max-sm:hidden" aria-hidden>
                    <WaveformIcon className="h-3.5 w-7" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {editingId === m.id ? (
                      <input
                        autoFocus
                        value={titleInput}
                        onChange={(e) => setTitleInput(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => saveTitle(m)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                          if (e.key === "Escape") {
                            skipBlurSaveRef.current = true;
                            setEditingId(null);
                          }
                        }}
                        aria-label="新標題"
                        className="field h-8 w-full rounded-xl px-2.5 text-sm font-medium"
                      />
                    ) : (
                      <Link to={`/media/${m.id}`} className="block truncate text-[15px] font-medium transition-colors hover:text-sonar">
                        {m.title}
                      </Link>
                    )}
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                      <span className="font-mono tabular-nums">{fmtDuration(m.duration_seconds)}</span>
                      <span aria-hidden>·</span>
                      <span className="font-mono">{fmtDate(m.created_at)}</span>
                      {currentFolder === null && m.folder && (
                        <span className="truncate rounded-full bg-fg/[0.06] px-2 py-0.5">{m.folder}</span>
                      )}
                      {m.source_type === "youtube" && (
                        <span className="rounded-full bg-fg/[0.06] px-2 py-0.5 font-mono text-[10px]">YT</span>
                      )}
                    </div>
                  </div>

                  {/* 狀態 */}
                  <div className="flex shrink-0 items-center justify-end gap-2 md:w-44">
                    {job ? (
                      <>
                        <div className="w-24 md:w-auto md:min-w-0 md:flex-1">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-amber">
                            <span>{jobStageLabel(job)}</span>
                            <span className="font-mono tabular-nums">{job.progress}%</span>
                          </div>
                          <ProgressBar value={job.progress} processing />
                        </div>
                        <button
                          onClick={() => cancelJob(job.id)}
                          disabled={job.cancel_requested}
                          className="press shrink-0 cursor-pointer rounded-full bg-fg/[0.06] px-2.5 py-0.5 text-[11px] text-fg-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                          title="終止任務"
                        >
                          {job.cancel_requested ? "終止中" : "終止"}
                        </button>
                      </>
                    ) : m.latest_job?.status === "error" ? (
                      <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs text-danger" title={m.latest_job.error_message ?? ""}>
                        失敗
                      </span>
                    ) : m.has_transcript ? (
                      <span className="flex items-center gap-1 rounded-full bg-sonar-soft px-2.5 py-1 text-xs text-sonar">
                        <CheckDraw className="h-3.5 w-3.5" /> 已轉錄
                      </span>
                    ) : (
                      <span className="rounded-full bg-fg/[0.05] px-2.5 py-1 text-xs text-fg-muted">未轉錄</span>
                    )}
                  </div>

                  <Select
                    size="sm"
                    value=""
                    onChange={(e) => {
                      if (e.target.value !== "") moveTo([m.id], e.target.value === "__inbox__" ? null : e.target.value);
                      e.target.value = "";
                    }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="移至資料夾"
                    title="移至資料夾"
                    className={`hidden w-20 md:block ${rowAction}`}
                  >
                    <option value="" disabled>
                      移至…
                    </option>
                    {m.folder !== null && <option value="__inbox__">未分類</option>}
                    {folders
                      .filter((f) => f.name !== m.folder)
                      .map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                  </Select>
                  <IconButton label="重新命名" tone="accent" onClick={() => startRename(m)} className={`-mx-1 ${rowAction}`}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </IconButton>
                  <IconButton label="刪除" tone="danger" onClick={() => deleteMedia([m.id])} className={`-mx-1 ${rowAction}`}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        folders={folders}
        initialFolder={currentFolder === "inbox" ? null : currentFolder}
        onUploaded={load}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        onConfirm={() => {
          confirm?.run();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/** 側欄資料夾圖示：全部 / 未分類 / 一般資料夾 */
function FolderGlyph({ kind, active }: { kind: "all" | "inbox" | "folder"; active: boolean }) {
  const d = {
    all: "M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z",
    inbox: "M4 13l2.5-7h11l2.5 7v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5zm0 0h4.5l1 2h5l1-2H20",
    folder: "M3.5 7a1.5 1.5 0 011.5-1.5h4l2 2h8a1.5 1.5 0 011.5 1.5v8.5a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5V7z",
  }[kind];
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 ${active ? "text-sonar" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
