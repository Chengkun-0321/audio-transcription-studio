/**
 * 媒體庫（儀表板）：資料夾側欄 + 媒體列表。
 * 功能：搜尋、排序、多選批次移動/刪除、拖曳歸檔（拖列到側欄資料夾）、
 * 單檔移至資料夾下拉、單檔就地改名、進行中任務即時進度與終止、上傳彈窗。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { fmtDate, fmtDuration, jobStageLabel } from "../lib/format";
import type { Folder, Media } from "../lib/types";
import { CheckDraw, WaveformIcon } from "../components/sonar";
import { ConfirmDialog, EmptyState, ProgressBar } from "../components/ui";
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:flex-row md:gap-8">
      {/* 側欄：手機為橫向捲動 chips 列，md 以上為直向清單 */}
      <aside className="flex w-full shrink-0 items-start gap-1 overflow-x-auto md:block md:w-52 md:overflow-visible">
        <ul className="flex gap-1 md:flex-col md:gap-0.5">
          {folderTargets.map((f) => (
            <li key={f.key ?? "__all__"} className="group relative">
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
                className={`flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                  currentFolder === f.key
                    ? "bg-sonar-soft font-medium text-sonar"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                } ${dragOverFolder === f.key ? "ring-2 ring-sonar" : ""}`}
              >
                <span className="truncate">{f.label}</span>
                {f.count != null && <span className="font-mono text-xs opacity-60">{f.count}</span>}
              </button>
              {f.key && f.key !== "inbox" && (
                <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 gap-0.5 group-hover:flex">
                  <button
                    onClick={() => {
                      setRenamingFolder(f.key);
                      setFolderInput(f.key!);
                      setNewFolderMode(true);
                    }}
                    className="rounded bg-surface p-1 text-fg-muted hover:text-fg"
                    title="重新命名"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <button
                    onClick={() => deleteFolder(f.key!)}
                    className="rounded bg-surface p-1 text-fg-muted hover:text-danger"
                    title="刪除資料夾"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>

        {newFolderMode ? (
          <div className="w-40 shrink-0 md:mt-2 md:w-auto md:px-1">
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
              className="w-full rounded-lg border border-sonar bg-surface px-2 py-1.5 text-sm outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setFolderInput("");
              setRenamingFolder(null);
              setNewFolderMode(true);
            }}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg md:mt-2 md:w-full"
          >
            <span className="text-base leading-none">＋</span> 新增資料夾
          </button>
        )}
      </aside>

      {/* 主列表 */}
      <section className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋檔名…"
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-sonar"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-fg-muted outline-none focus:border-sonar"
          >
            <option value="created">最新在前</option>
            <option value="duration">時長最長</option>
            <option value="title">名稱排序</option>
          </select>
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded-lg bg-sonar px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
          >
            上傳檔案
          </button>
        </div>

        {selected.size > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-sonar/40 bg-sonar-soft px-4 py-2 text-sm">
            <span className="font-mono">{selected.size}</span> 個已選取
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value !== "") moveTo([...selected], e.target.value === "__inbox__" ? null : e.target.value);
                e.target.value = "";
              }}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none"
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
            </select>
            <button onClick={() => deleteMedia([...selected])} className="text-danger hover:underline">
              刪除
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-fg-muted hover:text-fg">
              取消選取
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <EmptyState
            title={search ? "沒有符合搜尋的檔案" : "這裡還很安靜"}
            hint={search ? undefined : "上傳音訊或影片，或到下載器貼上 YouTube 網址。"}
            action={
              !search ? (
                <button
                  onClick={() => setUploadOpen(true)}
                  className="rounded-lg bg-sonar px-4 py-2 text-sm font-medium text-ink hover:opacity-90"
                >
                  上傳第一個檔案
                </button>
              ) : undefined
            }
          />
        ) : (
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {shown.map((m) => {
              const job = jobFor(m);
              return (
                <li
                  key={m.id}
                  draggable={editingId !== m.id}
                  onDragStart={(e) => onRowDragStart(e, m.id)}
                  className="group flex items-center gap-2 border-b border-line/60 px-3 py-3 transition-colors last:border-b-0 hover:bg-surface-hover md:gap-3 md:px-4"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggleSelect(m.id)}
                    className="opacity-100 transition-opacity focus:opacity-100 data-[checked]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    style={{ opacity: selected.has(m.id) ? 1 : undefined }}
                  />
                  <WaveformIcon className="h-4 w-8 shrink-0 text-sonar/70" />
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
                        className="w-full rounded-md border border-sonar bg-surface px-2 py-0.5 text-sm font-medium outline-none"
                      />
                    ) : (
                      <Link to={`/media/${m.id}`} className="block truncate text-sm font-medium hover:text-sonar">
                        {m.title}
                      </Link>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                      <span className="font-mono">{fmtDuration(m.duration_seconds)}</span>
                      <span>·</span>
                      <span className="font-mono">{fmtDate(m.created_at)}</span>
                      {currentFolder === null && m.folder && (
                        <>
                          <span>·</span>
                          <span className="rounded bg-surface-hover px-1.5 py-0.5">{m.folder}</span>
                        </>
                      )}
                      {m.source_type === "youtube" && (
                        <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">YT</span>
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
                            <span className="font-mono">{job.progress}%</span>
                          </div>
                          <ProgressBar value={job.progress} processing />
                        </div>
                        <button
                          onClick={() => cancelJob(job.id)}
                          disabled={job.cancel_requested}
                          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
                          title="終止任務"
                        >
                          {job.cancel_requested ? "終止中" : "終止"}
                        </button>
                      </>
                    ) : m.latest_job?.status === "error" ? (
                      <span className="text-xs text-danger" title={m.latest_job.error_message ?? ""}>
                        失敗
                      </span>
                    ) : m.has_transcript ? (
                      <span className="flex items-center gap-1 text-xs text-sonar">
                        <CheckDraw className="h-3.5 w-3.5" /> 已轉錄
                      </span>
                    ) : (
                      <span className="text-xs text-fg-muted">未轉錄</span>
                    )}
                  </div>

                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value !== "") moveTo([m.id], e.target.value === "__inbox__" ? null : e.target.value);
                      e.target.value = "";
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="hidden w-16 rounded-md border border-line bg-surface px-1 py-1 text-xs text-fg-muted opacity-0 outline-none transition-opacity focus:opacity-100 group-hover:opacity-100 md:block"
                    title="移至資料夾"
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
                  </select>
                  <button
                    onClick={() => startRename(m)}
                    className="rounded p-1.5 text-fg-muted opacity-100 transition-opacity hover:text-sonar md:opacity-0 md:group-hover:opacity-100"
                    title="重新命名"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <button
                    onClick={() => deleteMedia([m.id])}
                    className="rounded p-1.5 text-fg-muted opacity-100 transition-opacity hover:text-danger md:opacity-0 md:group-hover:opacity-100"
                    title="刪除"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
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
