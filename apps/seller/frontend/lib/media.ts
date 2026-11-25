/**
 * Sprint 7 (S7-B1): the media library's types and calls on the dashboard side (rename, where a file is used, delete). Pure: the caller passes the
 * store-aware fetch (useStoreFetch), so nothing here touches the browser and every function can be tested with a stub.
 */

type StoreFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A file of the library as GET /api/proxy/media sends it. */
export interface MediaItem {
  id: string;
  alt: string;
  /** The name the seller gave the file. Null until one is set; the alt text is shown then. */
  name?: string | null;
  url: string;
  resourceType?: "image" | "video";
  mimeType?: string | null;
  filesize?: number | null;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MediaUsageItem {
  id: string;
  title: string;
}

/** One place that uses a file: a feature (Products, Store settings, later Articles, Pages, Theme) and the first records of it. */
export interface MediaUsageFeature {
  key: string;
  label: string;
  count: number;
  items: MediaUsageItem[];
}

/** GET /api/proxy/media/:id/usage. */
export interface MediaUsage {
  mediaId: string;
  inUse: boolean;
  total: number;
  features: MediaUsageFeature[];
}

export const MEDIA_NAME_MAX = 120;

/** What the library shows for a file: its name, else its alt text. */
export function mediaDisplayName(item: Pick<MediaItem, "name" | "alt">): string {
  const name = typeof item.name === "string" ? item.name.trim() : "";
  return name !== "" ? name : item.alt;
}

function readUsage(source: unknown): MediaUsage | null {
  if (typeof source !== "object" || source === null) return null;
  const rec = source as Record<string, unknown>;
  if (!Array.isArray(rec.features)) return null;
  const features: MediaUsageFeature[] = [];
  for (const raw of rec.features) {
    if (typeof raw !== "object" || raw === null) continue;
    const f = raw as Record<string, unknown>;
    if (typeof f.key !== "string" || typeof f.label !== "string" || typeof f.count !== "number") continue;
    const items = Array.isArray(f.items)
      ? f.items.flatMap((i): MediaUsageItem[] => {
          const item = i as { id?: unknown; title?: unknown } | null;
          return item !== null && typeof item === "object" && typeof item.id === "string" ? [{ id: item.id, title: typeof item.title === "string" ? item.title : "" }] : [];
        })
      : [];
    features.push({ key: f.key, label: f.label, count: f.count, items });
  }
  const total = typeof rec.total === "number" ? rec.total : features.reduce((sum, f) => sum + f.count, 0);
  return { mediaId: typeof rec.mediaId === "string" ? rec.mediaId : "", inUse: total > 0, total, features };
}

/** "Products (3), Store settings (1)": the places a file is used, in one line. Empty when it is not used. */
export function describeUsage(usage: MediaUsage): string {
  return usage.features.map((feature) => `${feature.label} (${feature.count})`).join(", ");
}

export type MediaCallResult<T> = { ok: true; value: T } | { ok: false; message: string; field?: string; status: number; usage?: MediaUsage };

const NETWORK = "Could not reach the backend. Please try again.";

async function failure(res: Response, fallback: string): Promise<{ ok: false; message: string; field?: string; status: number; usage?: MediaUsage }> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown; field?: unknown; details?: unknown } | null;
  const message = typeof body?.error === "string" ? body.error : fallback;
  const field = typeof body?.field === "string" ? body.field : undefined;
  const usage = body?.code === "MEDIA_IN_USE" ? readUsage(body.details) : null;
  return { ok: false, message, status: res.status, ...(field === undefined ? {} : { field }), ...(usage === null ? {} : { usage }) };
}

/** Renames a file. Only the name is sent; the answer is the updated record (its url has not changed). A 400 names the field. */
export async function renameMedia(storeFetch: StoreFetch, id: string, name: string): Promise<MediaCallResult<MediaItem>> {
  try {
    const res = await storeFetch(`/api/proxy/media/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return await failure(res, "Could not rename this file.");
    return { ok: true, value: (await res.json()) as MediaItem };
  } catch {
    return { ok: false, message: NETWORK, status: 0 };
  }
}

/** Where a file is used. */
export async function fetchMediaUsage(storeFetch: StoreFetch, id: string): Promise<MediaCallResult<MediaUsage>> {
  try {
    const res = await storeFetch(`/api/proxy/media/${encodeURIComponent(id)}/usage`, { cache: "no-store" });
    if (!res.ok) return await failure(res, "Could not check where this file is used.");
    const usage = readUsage(await res.json().catch(() => null));
    return usage === null ? { ok: false, message: "Could not check where this file is used.", status: res.status } : { ok: true, value: usage };
  } catch {
    return { ok: false, message: NETWORK, status: 0 };
  }
}

/** Deletes a file. A file that is still used is refused (409) and the answer carries where, so the dialog can name the places. */
export async function deleteMedia(storeFetch: StoreFetch, id: string): Promise<MediaCallResult<true>> {
  try {
    const res = await storeFetch(`/api/proxy/media/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return await failure(res, "Could not delete this file.");
    return { ok: true, value: true };
  } catch {
    return { ok: false, message: NETWORK, status: 0 };
  }
}

// ------------------------------------------------------------------------------------------------------------ Sprint 7 (S7-B2): the library page

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** "1.2 MB", "340 KB", "12 B". Empty for a size that is not known. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The description a new upload starts with: the file name without its extension and its dashes. The seller can change it. */
export function defaultAltFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base === "" ? "Image" : base).slice(0, 200);
}

/** Why a file cannot be uploaded (the same limits the backend enforces), or null. Checked before anything is sent. */
export function uploadProblem(file: { type: string; size: number; name?: string }): string | null {
  const isVideo = file.type.startsWith("video/");
  const allowed: readonly string[] = isVideo ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES;
  if (!allowed.includes(file.type)) return isVideo ? "Use an MP4, WebM or MOV video." : "Use a JPG, PNG, WebP or GIF image.";
  if (file.size > (isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES)) return isVideo ? "A video can be at most 50 MB." : "An image can be at most 10 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

/** The files of the library that match a search (name, else alt text; any case). An empty search keeps everything. */
export function filterMedia<T extends Pick<MediaItem, "name" | "alt">>(items: readonly T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  if (q === "") return [...items];
  return items.filter((item) => mediaDisplayName(item).toLowerCase().includes(q) || item.alt.toLowerCase().includes(q));
}

export interface MediaPage {
  items: MediaItem[];
  page: number;
  totalPages: number;
  totalDocs: number;
}

/** One page of the library, newest first. */
export async function fetchMediaPage(storeFetch: StoreFetch, page = 1, limit = 24): Promise<MediaCallResult<MediaPage>> {
  try {
    const res = await storeFetch(`/api/proxy/media?page=${page}&limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return await failure(res, "Could not load your media.");
    const body = (await res.json().catch(() => null)) as { docs?: unknown; page?: unknown; totalPages?: unknown; totalDocs?: unknown } | null;
    if (body === null || !Array.isArray(body.docs)) return { ok: false, message: "Could not load your media.", status: res.status };
    const items = (body.docs as MediaItem[]).filter((doc) => typeof doc?.id === "string" && typeof doc?.url === "string");
    return {
      ok: true,
      value: {
        items,
        page: typeof body.page === "number" ? body.page : page,
        totalPages: typeof body.totalPages === "number" ? body.totalPages : 1,
        totalDocs: typeof body.totalDocs === "number" ? body.totalDocs : items.length,
      },
    };
  } catch {
    return { ok: false, message: NETWORK, status: 0 };
  }
}

/** Uploads one file with its description (alt text). The answer is the new record. */
export async function uploadMedia(storeFetch: StoreFetch, file: File, alt: string): Promise<MediaCallResult<MediaItem>> {
  const problem = uploadProblem(file);
  if (problem !== null) return { ok: false, message: problem, status: 0 };
  const form = new FormData();
  form.append("file", file);
  form.append("alt", alt.trim() === "" ? defaultAltFromFileName(file.name) : alt.trim().slice(0, 200));
  try {
    const res = await storeFetch("/api/proxy/media", { method: "POST", body: form });
    if (!res.ok) return await failure(res, "Could not upload this file.");
    return { ok: true, value: (await res.json()) as MediaItem };
  } catch {
    return { ok: false, message: NETWORK, status: 0 };
  }
}

/** The store-relative page a usage entry points to (the caller wraps it with the store-aware href), or null when there is none. */
export function usageItemPath(featureKey: string, itemId: string): string | null {
  if (featureKey === "products" && /^[0-9a-fA-F]{24}$/.test(itemId)) return `/products/${itemId}`;
  if (featureKey === "articles" && /^[0-9a-fA-F]{24}$/.test(itemId)) return `/blog/${itemId}`;
  if (featureKey === "branding") return "/store";
  return null;
}
