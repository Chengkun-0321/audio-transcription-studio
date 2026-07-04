/** 後端 API 的型別化包裝。所有請求走相對路徑 /api，由 Vite proxy 轉送。 */
import type { Folder, Job, Media, Transcript } from "./types";

/** fetch 包裝：非 2xx 時把後端的 detail 轉成可讀的 Error message。 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* 非 JSON 錯誤體，用狀態碼即可 */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

/** 產生 JSON POST 的 RequestInit（PATCH 等由呼叫端覆寫 method）。 */
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** 所有後端端點的呼叫函式（回傳型別即後端回應結構）。 */
export const api = {
  listMedia: (folder?: string | null) =>
    request<Media[]>(`/api/media${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`),
  getMedia: (id: string) => request<Media>(`/api/media/${id}`),
  renameMedia: (id: string, title: string) =>
    request<Media>(`/api/media/${id}`, { ...json({ title }), method: "PATCH" }),
  moveMedia: (id: string, folder: string | null) =>
    request<Media>(`/api/media/${id}/move`, { ...json({ folder }), method: "PATCH" }),
  deleteMedia: (id: string) => request<{ ok: boolean }>(`/api/media/${id}`, { method: "DELETE" }),
  mediaFileUrl: (id: string) => `/api/media/${id}/file`,

  downloadYoutube: (url: string, format: "mp4" | "mp3", folder?: string | null) =>
    request<{ media: Media; job: Job }>("/api/media/youtube", json({ url, format, folder })),

  listFolders: () => request<Folder[]>("/api/folders"),
  createFolder: (name: string) => request<{ ok: boolean }>("/api/folders", json({ name })),
  renameFolder: (name: string, newName: string) =>
    request<{ ok: boolean }>(`/api/folders/${encodeURIComponent(name)}`, {
      ...json({ name: newName }),
      method: "PATCH",
    }),
  deleteFolder: (name: string) =>
    request<{ ok: boolean; moved_to_inbox: number }>(`/api/folders/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  createJob: (opts: {
    media_id: string;
    mode: string;
    language: string;
    diarization: boolean;
    denoise: boolean;
  }) => request<Job>("/api/jobs", json(opts)),
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  listJobs: (activeOnly = false) => request<Job[]>(`/api/jobs${activeOnly ? "?active=true" : ""}`),
  getSegments: (jobId: string) => request<Transcript>(`/api/jobs/${jobId}/segments`),
  transcriptUrl: (jobId: string, format: "txt" | "srt" | "docx", timestamps = true) =>
    `/api/jobs/${jobId}/transcript?format=${format}${timestamps ? "" : "&timestamps=false"}`,
};

/** 檔案上傳：用 XHR 而非 fetch，因為 fetch 拿不到 upload progress 事件。 */
export function uploadFile(
  file: File,
  folder: string | null,
  onProgress: (pct: number) => void,
): Promise<Media> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (folder) form.append("folder", folder);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else {
        try {
          reject(new Error(JSON.parse(xhr.responseText).detail ?? `上傳失敗 (${xhr.status})`));
        } catch {
          reject(new Error(`上傳失敗 (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("網路錯誤，上傳中斷"));
    xhr.send(form);
  });
}
