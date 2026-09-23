/**
 * 上傳彈窗：多檔拖放（聲納 ping 動效）、目的資料夾選擇、逐檔上傳進度。
 * 「上傳後立即轉錄」開啟時，每個檔案上傳完成即自動建立轉錄任務。
 */
import { useRef, useState, type DragEvent } from "react";
import { useApp } from "../context/AppContext";
import { api, uploadFile } from "../lib/api";
import type { Folder } from "../lib/types";
import { SonarPing } from "./sonar";
import { Button, IconButton, Modal, ProgressBar, Select, Switch } from "./ui";
import { defaultSettings, TranscribeOptions, type TranscribeSettings } from "./TranscribeOptions";

const ACCEPT = ".mp3,.mp4,.m4a,.mov,.aac,.wav,.ogg,.opus,.mpeg,.wma,.wmv";

interface FileItem {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export function UploadModal({
  open,
  onClose,
  folders,
  initialFolder,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  folders: Folder[];
  initialFolder: string | null;
  onUploaded: () => void;
}) {
  const { toast, refreshJobs } = useApp();
  const [items, setItems] = useState<FileItem[]>([]);
  const [settings, setSettings] = useState<TranscribeSettings>(defaultSettings);
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 加入待上傳清單，過濾不支援的副檔名。 */
  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) =>
      ACCEPT.split(",").includes("." + (f.name.split(".").pop() ?? "").toLowerCase()),
    );
    if (list.length < Array.from(files).length) toast("已略過不支援的檔案格式", "info");
    setItems((prev) => [
      ...prev,
      ...list.map((file) => ({ file, progress: 0, status: "pending" as const })),
    ]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  /** 逐檔依序上傳（XHR 進度回報），成功且開啟自動轉錄時建立轉錄任務。 */
  const start = async () => {
    if (items.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "done") continue;
      setItems((p) => p.map((it, j) => (j === i ? { ...it, status: "uploading" } : it)));
      try {
        const media = await uploadFile(items[i].file, folder, (pct) =>
          setItems((p) => p.map((it, j) => (j === i ? { ...it, progress: pct } : it))),
        );
        if (autoTranscribe) {
          await api.createJob({ media_id: media.id, ...settings });
        }
        setItems((p) => p.map((it, j) => (j === i ? { ...it, status: "done", progress: 100 } : it)));
        ok++;
      } catch (e) {
        setItems((p) =>
          p.map((it, j) =>
            j === i ? { ...it, status: "error", error: (e as Error).message } : it,
          ),
        );
      }
    }
    setBusy(false);
    refreshJobs();
    onUploaded();
    if (ok > 0) {
      toast(
        autoTranscribe ? `已上傳 ${ok} 個檔案並開始轉錄` : `已上傳 ${ok} 個檔案`,
        "success",
      );
      setItems([]);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="上傳媒體檔案" wide>
      <div className="flex flex-col gap-5">
        {/* 拖放區 */}
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-row border-[1.5px] border-dashed p-6 transition-colors ${
            dragging
              ? "border-sonar bg-sonar-soft"
              : "border-fg/15 bg-fg/[0.03] hover:border-fg/30 hover:bg-fg/[0.05]"
          }`}
        >
          <SonarPing active={dragging} />
          <span className="glass relative mb-1 flex h-12 w-12 items-center justify-center rounded-full text-sonar">
            <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
              <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
          </span>
          <p className="text-sm font-medium">拖放檔案到這裡，或點擊選擇</p>
          <p className="font-mono text-[11px] text-fg-muted">
            MP3 · MP4 · M4A · MOV · AAC · WAV · OGG · OPUS · MPEG · WMA · WMV
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        {/* 檔案清單 */}
        {items.length > 0 && (
          <ul className="flex flex-col gap-2">
            {items.map((it, i) => (
              <li key={i} className="rounded-row bg-fg/[0.04] py-2 pl-4 pr-2">
                <div className="flex min-h-8 items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{it.file.name}</span>
                  <span
                    className={`shrink-0 font-mono text-xs tabular-nums text-fg-muted ${
                      !busy && it.status === "pending" ? "" : "mr-2"
                    }`}
                  >
                    {it.status === "error" ? (
                      <span className="text-danger">{it.error}</span>
                    ) : it.status === "done" ? (
                      "完成"
                    ) : it.status === "uploading" ? (
                      `${it.progress}%`
                    ) : (
                      `${(it.file.size / 1024 / 1024).toFixed(1)} MB`
                    )}
                  </span>
                  {!busy && it.status === "pending" && (
                    <IconButton
                      label="移除"
                      tone="danger"
                      size="sm"
                      onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2}>
                        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                      </svg>
                    </IconButton>
                  )}
                </div>
                {it.status === "uploading" && <ProgressBar value={it.progress} className="mb-1 mr-2 mt-2" />}
              </li>
            ))}
          </ul>
        )}

        {/* 目的資料夾 + 是否轉錄 */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2.5 text-sm">
            <span className="text-fg-muted">存到資料夾</span>
            <Select value={folder ?? ""} onChange={(e) => setFolder(e.target.value || null)} className="min-w-36">
              <option value="">未分類</option>
              {folders.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Switch checked={autoTranscribe} onChange={setAutoTranscribe} />
            上傳後立即轉錄
          </label>
        </div>

        {autoTranscribe && <TranscribeOptions value={settings} onChange={setSettings} />}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <Button variant="glass" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={start} disabled={busy || items.length === 0}>
            {busy ? "上傳中…" : autoTranscribe ? "上傳並轉錄" : "上傳"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
