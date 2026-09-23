/**
 * 模型頁：列出所有 Whisper 模型與本機狀態（已下載／下載中／未下載、佔用空間），
 * 可預先下載、取消下載、刪除。轉錄任務第一次用到某模型時也會自動下載，進度同樣顯示在這裡。
 * 下載中或有轉錄任務時每 1.5 秒輪詢，其餘靠 jobsVersion 刷新。
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { fmtBytes } from "../lib/format";
import type { WhisperModel } from "../lib/types";
import { CheckDraw } from "../components/sonar";
import { Badge, Button, ConfirmDialog, IconButton, MetaLine, ProgressBar } from "../components/ui";

function ModelGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2a2 2 0 002 1.8h5.4a2 2 0 002-1.8L17.5 7M9.5 7V5a1 1 0 011-1h3a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ModelsPage() {
  const { toast, activeJobs, jobsVersion } = useApp();
  const [models, setModels] = useState<WhisperModel[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WhisperModel | null>(null);

  const load = useCallback(() => {
    api
      .listModels()
      .then(setModels)
      .catch((e) => toast((e as Error).message, "error"));
  }, [toast]);

  useEffect(load, [load, jobsVersion]);

  // 轉錄任務可能正在下載或使用模型：有下載或有轉錄任務時持續輪詢，分頁在背景時跳過
  const watching =
    !!models?.some((m) => m.status === "downloading") || activeJobs.some((j) => j.type === "transcribe");
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => !document.hidden && load(), 1500);
    return () => clearInterval(t);
  }, [watching, load]);

  /** 執行操作後立即刷新；後端拒絕（409 使用中等）以 toast 顯示原因。 */
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast(success, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    load();
  };

  const doDelete = (m: WhisperModel) => {
    setConfirmDelete(null);
    act(() => api.deleteModel(m.key), `已刪除 ${m.key}`);
  };

  const downloaded = models?.filter((m) => m.status === "downloaded") ?? [];
  const totalBytes = models?.reduce((sum, m) => sum + m.size_bytes, 0) ?? 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight md:text-[28px]">模型</h1>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
          Whisper 語音辨識模型，第一次使用時會自動下載。
          {models && (
            <>
              已下載 <span className="font-mono tabular-nums">{downloaded.length}</span> 個，共佔用{" "}
              <span className="font-mono tabular-nums">{fmtBytes(totalBytes)}</span>。
            </>
          )}
        </p>
      </div>

      {models && (
        <ul className="glass-card relative rounded-panel p-2" aria-label="Whisper 模型">
          {models.map((m, i) => {
            const partial = m.status === "absent" && m.size_bytes > 0;
            const deletable = m.size_bytes > 0 && m.status !== "downloading";
            return (
              <li
                key={m.key}
                style={{ "--i": i } as CSSProperties}
                // 列間分隔線從文字起點開始（跳過圖示），同媒體庫列表
                className="rise-in relative flex items-center gap-3 rounded-row p-2 before:absolute before:left-3 before:right-3 before:top-0 before:h-px before:bg-line first:before:hidden sm:before:left-[60px]"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-tile max-sm:hidden ${
                    m.status === "downloaded" ? "bg-sonar-soft text-sonar" : "bg-fg/[0.05] text-fg-muted"
                  }`}
                  aria-hidden
                >
                  <ModelGlyph />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[15px] font-medium leading-6">{m.key}</span>
                    {m.default && <Badge tone="sonar">推薦</Badge>}
                    {m.in_use && <Badge tone="amber">使用中</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{m.note}</p>
                  <MetaLine
                    className="mt-1"
                    items={[
                      { label: "參數", value: m.params, mono: true },
                      { label: "下載大小", value: fmtBytes(m.download_mb * 1e6), mono: true },
                      m.size_bytes > 0 && { label: "本機佔用", value: fmtBytes(m.size_bytes), mono: true },
                    ]}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {m.status === "downloading" ? (
                    <>
                      <div className="w-24 md:w-36">
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-amber">
                          <span>下載中</span>
                          <span className="font-mono tabular-nums">{m.progress ?? 0}%</span>
                        </div>
                        <ProgressBar value={m.progress ?? 0} processing />
                      </div>
                      <Button
                        variant="glass-danger"
                        size="sm"
                        onClick={() => act(() => api.cancelModelDownload(m.key))}
                        disabled={m.in_use}
                        title={m.in_use ? "轉錄任務正在等這個模型，請從任務列表終止該任務" : undefined}
                      >
                        取消
                      </Button>
                    </>
                  ) : m.status === "downloaded" ? (
                    <Badge tone="sonar">
                      <CheckDraw className="h-3.5 w-3.5" /> 已下載
                    </Badge>
                  ) : (
                    <>
                      {partial && (
                        <Badge tone="amber" className="max-sm:hidden">
                          未完成
                        </Badge>
                      )}
                      <Button size="sm" onClick={() => act(() => api.downloadModel(m.key))}>
                        {partial ? "繼續下載" : "下載"}
                      </Button>
                    </>
                  )}
                  {deletable && (
                    <IconButton
                      label={m.in_use ? "轉錄任務正在使用，無法刪除" : `刪除 ${m.key}`}
                      tone="danger"
                      disabled={m.in_use}
                      onClick={() => setConfirmDelete(m)}
                    >
                      <TrashIcon />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-1 text-xs leading-relaxed text-fg-muted">
        模型存放在專案的 <span className="font-mono">models/hub/</span>
        ，刪除後轉錄結果不受影響，下次使用會重新下載。說話者識別用的 pyannote 模型也在同一資料夾，不列在這裡。
      </p>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`刪除 ${confirmDelete?.key ?? ""}？`}
        message={`會刪除本機的模型檔（${fmtBytes(confirmDelete?.size_bytes ?? 0)}），已完成的轉錄結果不受影響。之後再用這個模型時會自動重新下載。`}
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
