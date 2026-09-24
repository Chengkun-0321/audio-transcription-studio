/**
 * 媒體庫（儀表板）：資料夾側欄 + 頁面標題 + 工具列 + 媒體列表。
 * 功能：搜尋、排序、選取模式（批次移動/刪除）、拖曳歸檔（拖列到側欄資料夾）、
 * 每列常駐 ⋯ 選單／右鍵選單（開啟、重新命名、移至資料夾、刪除）、資料夾改名/刪除、
 * 進行中任務即時進度與終止、上傳彈窗。
 * 一次抓全部媒體，資料夾篩選與各資料夾數量都在前端算，側欄每一列都有數字。
 */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { fmtDateTime, fmtDuration, jobStageLabel, SOURCE_LABEL } from "../lib/format";
import { exitFast, spring, springBead } from "../lib/motion";
import type { Folder, Media } from "../lib/types";
import { CheckDraw, WaveformIcon } from "../components/sonar";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Menu,
  MetaLine,
  MoreIcon,
  ProgressBar,
  Select,
  type MenuEntry,
  type PopoverAnchor,
} from "../components/ui";
import { UploadModal } from "../components/UploadModal";

type SortKey = "created" | "duration" | "title";
/** null = 全部檔案、"inbox" = 未分類、其他 = 資料夾名 */
type FolderKey = string | null;

type MenuState =
  | { kind: "row"; media: Media; anchor: PopoverAnchor }
  | { kind: "folder"; anchor: PopoverAnchor }
  | { kind: "bulk-move"; anchor: PopoverAnchor };

const ICON = {
  open: <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />,
  rename: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round" />,
  trash: <path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14" strokeLinecap="round" strokeLinejoin="round" />,
  folder: <path d="M3.5 7a1.5 1.5 0 011.5-1.5h4l2 2h8a1.5 1.5 0 011.5 1.5v8.5a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5V7z" strokeLinejoin="round" />,
  inbox: <path d="M4 13l2.5-7h11l2.5 7v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5zm0 0h4.5l1 2h5l1-2H20" strokeLinejoin="round" />,
};

const Glyph = ({ d }: { d: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    {d}
  </svg>
);

export function DashboardPage() {
  const { toast, activeJobs, jobsVersion, refreshJobs } = useApp();
  const navigate = useNavigate();
  const [allMedia, setAllMedia] = useState<Media[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<FolderKey>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("created");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderInput, setNewFolderInput] = useState("");
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [folderRenameInput, setFolderRenameInput] = useState("");
  const [dragOverFolder, setDragOverFolder] = useState<FolderKey | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const skipBlurSaveRef = useRef(false); // Esc 取消後，輸入框卸載觸發的 blur 不要存檔
  const skipFolderBlurRef = useRef(false); // 同上，給新增／改名資料夾的輸入框

  const load = useCallback(async () => {
    try {
      const [m, f] = await Promise.all([api.listMedia(), api.listFolders()]);
      setAllMedia(m);
      setFolders(f);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load, jobsVersion]);

  // 換資料夾就清掉選取，避免對看不到的檔案做批次操作
  useEffect(() => {
    setSelected(new Set());
    setRenamingFolder(false);
  }, [currentFolder]);

  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    let inbox = 0;
    for (const m of allMedia) {
      if (m.folder === null) inbox++;
      else byFolder.set(m.folder, (byFolder.get(m.folder) ?? 0) + 1);
    }
    return { all: allMedia.length, inbox, byFolder };
  }, [allMedia]);

  const inFolder = useMemo(
    () =>
      currentFolder === null
        ? allMedia
        : allMedia.filter((m) => (currentFolder === "inbox" ? m.folder === null : m.folder === currentFolder)),
    [allMedia, currentFolder],
  );

  const shown = useMemo(() => {
    let list = inFolder;
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
  }, [inFolder, search, sort]);

  const jobFor = (m: Media) => activeJobs.find((j) => j.media_id === m.id);
  /** 目前所在的自訂資料夾（全部檔案、未分類時為 null） */
  const userFolder = currentFolder !== null && currentFolder !== "inbox" ? currentFolder : null;
  const folderTitle = currentFolder === null ? "全部檔案" : currentFolder === "inbox" ? "未分類" : currentFolder;

  /* ---- 資料夾操作 ---- */

  const createFolder = async () => {
    const name = newFolderInput.trim();
    setNewFolderMode(false);
    setNewFolderInput("");
    if (skipFolderBlurRef.current || !name) return;
    try {
      await api.createFolder(name);
      await load();
      setCurrentFolder(name);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const renameFolder = async () => {
    const name = folderRenameInput.trim();
    setRenamingFolder(false);
    if (skipFolderBlurRef.current || !userFolder || !name || name === userFolder) return;
    try {
      await api.renameFolder(userFolder, name);
      setCurrentFolder(name);
      load();
      toast("資料夾已重新命名", "success");
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
      setAllMedia((p) => p.map((x) => (x.id === m.id ? updated : x)));
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

  /* ---- 選取模式 ---- */

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allShownSelected = shown.length > 0 && shown.every((m) => selected.has(m.id));

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  /* ---- 拖曳歸檔 ---- */
  const onRowDragStart = (e: DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("text/media-ids", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  const onFolderDrop = (e: DragEvent, folder: string | null) => {
    e.preventDefault();
    setDragOverFolder(undefined);
    const data = e.dataTransfer.getData("text/media-ids");
    if (data) moveTo(JSON.parse(data), folder);
  };

  /* ---- 選單內容 ---- */

  /** 「移至資料夾」分組：列出目前所在以外的資料夾。 */
  const moveEntries = (ids: string[], exclude: string | null | undefined): MenuEntry[] => {
    const targets: MenuEntry[] = [
      ...(exclude !== null
        ? [{ label: "未分類", icon: <Glyph d={ICON.inbox} />, onSelect: () => moveTo(ids, null) }]
        : []),
      ...folders
        .filter((f) => f.name !== exclude)
        .map((f) => ({ label: f.name, icon: <Glyph d={ICON.folder} />, onSelect: () => moveTo(ids, f.name) })),
    ];
    return [
      { kind: "section", label: "移至資料夾" },
      ...(targets.length > 0 ? targets : [{ kind: "note" as const, label: "還沒有其他資料夾，可在左側「新增資料夾」。" }]),
    ];
  };

  const menuItems = (): MenuEntry[] => {
    if (!menu) return [];
    if (menu.kind === "folder" && userFolder)
      return [
        {
          label: "重新命名資料夾",
          icon: <Glyph d={ICON.rename} />,
          onSelect: () => {
            skipFolderBlurRef.current = false;
            setFolderRenameInput(userFolder);
            setRenamingFolder(true);
          },
        },
        { kind: "separator" },
        { label: "刪除資料夾", icon: <Glyph d={ICON.trash} />, danger: true, onSelect: () => deleteFolder(userFolder) },
      ];
    if (menu.kind === "bulk-move") return moveEntries([...selected], undefined);
    if (menu.kind === "row") {
      const m = menu.media;
      return [
        { label: "開啟", icon: <Glyph d={ICON.open} />, onSelect: () => navigate(`/media/${m.id}`) },
        { label: "重新命名", icon: <Glyph d={ICON.rename} />, onSelect: () => startRename(m) },
        { kind: "separator" },
        ...moveEntries([m.id], m.folder),
        { kind: "separator" },
        { label: "刪除檔案", icon: <Glyph d={ICON.trash} />, danger: true, onSelect: () => deleteMedia([m.id]) },
      ];
    }
    return [];
  };

  /* ---- 側欄 ---- */

  const sidebarGroups: { title: string; items: { key: FolderKey; label: string; count: number; kind: "all" | "inbox" | "folder" }[] }[] = [
    {
      title: "媒體庫",
      items: [
        { key: null, label: "全部檔案", count: counts.all, kind: "all" },
        { key: "inbox", label: "未分類", count: counts.inbox, kind: "inbox" },
      ],
    },
    {
      title: "資料夾",
      items: folders.map((f) => ({ key: f.name, label: f.name, count: counts.byFolder.get(f.name) ?? 0, kind: "folder" as const })),
    },
  ];

  const sidebarRow = (f: (typeof sidebarGroups)[number]["items"][number]) => {
    const active = currentFolder === f.key;
    // 「全部檔案」不是拖放目標（拖進去沒有意義）
    const droppable = f.key !== null;
    return (
      <li key={f.key ?? "__all__"} className="shrink-0">
        <button
          onClick={() => setCurrentFolder(f.key)}
          onDragOver={(e) => {
            if (!droppable) return;
            e.preventDefault();
            setDragOverFolder(f.key);
          }}
          onDragLeave={() => setDragOverFolder(undefined)}
          onDrop={(e) => droppable && onFolderDrop(e, f.key === "inbox" ? null : f.key)}
          aria-current={active ? "true" : undefined}
          className={`press relative flex h-10 w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-full px-3.5 text-sm transition-colors md:rounded-row md:px-3 ${
            active ? "font-medium text-fg" : "text-fg-muted hover:text-fg max-md:bg-fg/[0.05] md:hover:bg-fg/[0.05]"
          } ${droppable && dragOverFolder === f.key ? "ring-2 ring-sonar" : ""}`}
        >
          {active && (
            <motion.span layoutId="folder-bead" className="bead absolute inset-0 rounded-[inherit]" transition={springBead} />
          )}
          <span className="relative flex min-w-0 items-center gap-2.5">
            <FolderGlyph kind={f.kind} active={active} />
            <span className="truncate">{f.label}</span>
          </span>
          <span className="relative font-mono text-xs tabular-nums text-fg-muted">{f.count}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex w-full flex-col gap-5 md:flex-row md:gap-6">
      {/* 側欄：手機為橫向捲動 chips 列，md 以上為玻璃面板（分「媒體庫」「資料夾」兩組） */}
      <aside className="w-full shrink-0 md:w-60" aria-label="資料夾">
        <div className="md:glass-card md:sticky md:top-20 md:rounded-panel md:p-2">
          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:block md:overflow-visible md:p-0">
            {sidebarGroups.map((g) => (
              <div key={g.title} className="contents md:block">
                <p className="hidden px-3 pb-1 pt-2 text-[11px] font-medium text-fg-muted md:block">{g.title}</p>
                <ul className="flex gap-2 md:flex-col md:gap-0.5">{g.items.map(sidebarRow)}</ul>
              </div>
            ))}

            <div className="shrink-0 md:mt-0.5">
              {newFolderMode ? (
                <input
                  autoFocus
                  value={newFolderInput}
                  onChange={(e) => setNewFolderInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                    if (e.key === "Escape") {
                      skipFolderBlurRef.current = true;
                      setNewFolderMode(false);
                    }
                  }}
                  onBlur={createFolder}
                  placeholder="資料夾名稱"
                  aria-label="新資料夾名稱"
                  className="field h-10 w-40 rounded-full px-3.5 text-sm md:w-full"
                />
              ) : (
                <button
                  onClick={() => {
                    skipFolderBlurRef.current = false;
                    setNewFolderInput("");
                    setNewFolderMode(true);
                  }}
                  className="press flex h-10 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-full px-3.5 text-sm text-fg-muted hover:text-fg max-md:bg-fg/[0.05] md:w-full md:rounded-row md:px-3 md:hover:bg-fg/[0.05]"
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

      {/* 主區 */}
      <section className="min-w-0 flex-1">
        {/* 頁面標題：目前位置 + 檔案數；自訂資料夾有 ⋯（改名、刪除）。標題列固定 h-10，改名時不跳動 */}
        <div className="mb-4">
          <div className="flex h-10 items-center gap-2">
            {renamingFolder ? (
              <input
                autoFocus
                value={folderRenameInput}
                onChange={(e) => setFolderRenameInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                  if (e.key === "Escape") {
                    skipFolderBlurRef.current = true;
                    setRenamingFolder(false);
                  }
                }}
                onBlur={renameFolder}
                aria-label="資料夾新名稱"
                className="field h-10 w-full max-w-md rounded-full px-4 font-display text-lg font-semibold"
              />
            ) : (
              <h1 className="truncate font-display text-2xl font-semibold leading-tight tracking-tight md:text-[28px]">
                {folderTitle}
              </h1>
            )}
            {userFolder && !renamingFolder && (
              <IconButton
                label="資料夾操作"
                variant="glass"
                size="sm"
                aria-haspopup="menu"
                onClick={(e) => setMenu(menu?.kind === "folder" ? null : { kind: "folder", anchor: e.currentTarget })}
              >
                <MoreIcon />
              </IconButton>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            <span className="font-mono tabular-nums">{inFolder.length}</span> 個檔案
            {search.trim() && (
              <>
                ，符合搜尋 <span className="font-mono tabular-nums">{shown.length}</span> 個
              </>
            )}
          </p>
        </div>

        {/* 工具列：一般模式 ↔ 選取模式 */}
        <AnimatePresence mode="wait" initial={false}>
          {selectMode ? (
            <motion.div
              key="select"
              // 膠囊外框 48px（p-1 + 40）；-mt-1 mb-3 讓佔位與一般工具列（40 + mb-4）相同，切換時列表不跳動
              className="glass-strong sticky top-16 z-10 -mt-1 mb-3 flex flex-wrap items-center gap-2 rounded-panel p-1 sm:rounded-full"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0, transition: spring }}
              exit={{ opacity: 0, transition: exitFast }}
            >
              <Button variant="primary" onClick={exitSelectMode}>
                完成
              </Button>
              <span className="px-1 text-sm">
                已選取 <span className="font-mono tabular-nums">{selected.size}</span> 個
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((m) => m.id)))}
                  disabled={shown.length === 0}
                >
                  {allShownSelected ? "取消全選" : "全選"}
                </Button>
                <Button
                  variant="glass"
                  disabled={selected.size === 0}
                  aria-haspopup="menu"
                  onClick={(e) =>
                    setMenu(menu?.kind === "bulk-move" ? null : { kind: "bulk-move", anchor: e.currentTarget })
                  }
                >
                  移至資料夾
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Button>
                <Button variant="glass-danger" disabled={selected.size === 0} onClick={() => deleteMedia([...selected])}>
                  刪除
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="normal"
              className="mb-4 flex flex-wrap items-center gap-2"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: spring }}
              exit={{ opacity: 0, transition: exitFast }}
            >
              <label className="relative basis-full sm:min-w-48 sm:flex-1 sm:basis-auto">
                <span className="sr-only">搜尋媒體名稱</span>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜尋媒體名稱…"
                  className="field h-10 w-full rounded-full pl-10 pr-4 text-sm placeholder:text-fg-muted/60"
                />
              </label>
              <Select
                aria-label="排序方式"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="max-sm:min-w-0 max-sm:flex-1"
              >
                <option value="created">排序：最新加入</option>
                <option value="duration">排序：時長最長</option>
                <option value="title">排序：名稱</option>
              </Select>
              <Button variant="glass" onClick={() => setSelectMode(true)} disabled={shown.length === 0}>
                選取
              </Button>
              <Button variant="primary" onClick={() => setUploadOpen(true)}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                  <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="sm:hidden">上傳</span>
                <span className="max-sm:hidden">上傳檔案</span>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {shown.length === 0 ? (
          <EmptyState
            title={search ? "沒有符合搜尋的檔案" : currentFolder === null ? "這裡還很安靜" : "這個資料夾是空的"}
            hint={
              search
                ? undefined
                : currentFolder === null
                  ? "上傳音訊或影片，或到下載器貼上 YouTube 網址。"
                  : "按「上傳檔案」，或把其他檔案拖到左側這個資料夾。"
            }
            action={
              !search ? (
                <Button variant="primary" onClick={() => setUploadOpen(true)} className="mt-2">
                  上傳檔案
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul
            className="glass-card relative rounded-panel p-2 [&>li:hover+li]:before:opacity-0 [&>li[data-selected]+li]:before:opacity-0"
            aria-label={`${folderTitle}的媒體`}
          >
            {shown.map((m, i) => {
              const job = jobFor(m);
              const checked = selected.has(m.id);
              const editing = editingId === m.id;
              return (
                <li
                  key={m.id}
                  draggable={!editing}
                  onDragStart={(e) => onRowDragStart(e, m.id)}
                  onClick={selectMode ? () => toggleSelect(m.id) : undefined}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ kind: "row", media: m, anchor: { x: e.clientX, y: e.clientY } });
                  }}
                  data-selected={checked || undefined}
                  style={{ "--i": i } as CSSProperties}
                  // 列間分隔線從文字起點開始（跳過圖示），滑過或選取的列上下線隱藏
                  className={`rise-in group relative flex items-center gap-3 rounded-row p-2 transition-colors before:absolute before:right-3 before:top-0 before:h-px before:bg-line first:before:hidden hover:before:opacity-0 data-[selected]:before:opacity-0 ${
                    selectMode ? "cursor-pointer before:left-10 sm:before:left-[92px]" : "before:left-3 sm:before:left-[60px]"
                  } ${checked ? "bg-sonar-soft" : "hover:bg-fg/[0.05]"}`}
                >
                  {selectMode && (
                    <span className="pl-1" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={checked} onChange={() => toggleSelect(m.id)} label={`選取「${m.title}」`} />
                    </span>
                  )}
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile bg-sonar-soft text-sonar max-sm:hidden"
                    aria-hidden
                  >
                    <MediaGlyph kind={m.media_kind} />
                  </span>

                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <input
                        autoFocus
                        value={titleInput}
                        onChange={(e) => setTitleInput(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => saveTitle(m)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                          if (e.key === "Escape") {
                            skipBlurSaveRef.current = true;
                            setEditingId(null);
                          }
                        }}
                        aria-label="新標題"
                        className="field relative z-10 -my-1.5 h-8 w-full rounded-full px-3 text-sm font-medium"
                      />
                    ) : selectMode ? (
                      <span className="block truncate text-[15px] font-medium leading-5">{m.title}</span>
                    ) : (
                      // 整列可點：連結的 ::after 撐滿整列；draggable=false 讓拖曳交給 <li>
                      <Link
                        to={`/media/${m.id}`}
                        draggable={false}
                        className="block truncate text-[15px] font-medium leading-5 after:absolute after:inset-0"
                      >
                        {m.title}
                      </Link>
                    )}
                    {/* 標題 20 + 間距 2 + 資訊列 16 = 38 ≤ 圖示 40：列高固定 56，圖示四邊都內縮 8px（同心） */}
                    <MetaLine
                      className="mt-0.5"
                      items={[
                        { label: "時長", value: fmtDuration(m.duration_seconds), mono: true },
                        { label: "加入", value: fmtDateTime(m.created_at) },
                        { label: "來源", value: SOURCE_LABEL[m.source_type], optional: true },
                        currentFolder === null && { label: "資料夾", value: m.folder ?? "未分類", optional: true },
                      ]}
                    />
                  </div>

                  {/* 狀態與操作：浮在整列連結之上 */}
                  <div className="relative z-10 flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {job ? (
                      <>
                        <div className="w-24 md:w-36">
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-amber">
                            <span className="truncate">{jobStageLabel(job)}</span>
                            <span className="font-mono tabular-nums">{job.progress}%</span>
                          </div>
                          <ProgressBar value={job.progress} processing />
                        </div>
                        <Button
                          variant="glass-danger"
                          size="sm"
                          onClick={() => cancelJob(job.id)}
                          disabled={job.cancel_requested}
                          className="max-sm:hidden"
                        >
                          {job.cancel_requested ? "終止中…" : "終止"}
                        </Button>
                      </>
                    ) : m.latest_job?.status === "error" ? (
                      <Badge tone="danger" title={m.latest_job.error_message ?? ""}>
                        {m.latest_job.type === "download" ? "下載失敗" : "轉錄失敗"}
                      </Badge>
                    ) : m.has_transcript ? (
                      <Badge tone="sonar">
                        <CheckDraw className="h-3.5 w-3.5" /> 已轉錄
                      </Badge>
                    ) : (
                      <Badge>未轉錄</Badge>
                    )}
                    <IconButton
                      label="更多操作"
                      aria-haspopup="menu"
                      onClick={(e) =>
                        setMenu(
                          menu?.kind === "row" && menu.media.id === m.id
                            ? null
                            : { kind: "row", media: m, anchor: e.currentTarget },
                        )
                      }
                    >
                      <MoreIcon />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Menu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={menuItems()}
        label={menu?.kind === "folder" ? "資料夾操作" : menu?.kind === "bulk-move" ? "移至資料夾" : "檔案操作"}
        align={menu?.kind === "folder" ? "start" : "end"}
      />
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        folders={folders}
        initialFolder={userFolder}
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

/** 列表圖示：影片用播放鍵、音訊用波形 */
function MediaGlyph({ kind }: { kind: Media["media_kind"] }) {
  if (kind === "video")
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
        <path d="M8 5.8v12.4a1 1 0 001.5.86l10.2-6.2a1 1 0 000-1.72L9.5 4.94A1 1 0 008 5.8z" />
      </svg>
    );
  return <WaveformIcon className="h-3.5 w-7" />;
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
