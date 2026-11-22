"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Film, Loader2, Pencil, Search, Trash2, Upload, ListTree } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { useStoreHref } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import {
  MEDIA_NAME_MAX,
  defaultAltFromFileName,
  deleteMedia,
  fetchMediaPage,
  fetchMediaUsage,
  filterMedia,
  formatFileSize,
  mediaDisplayName,
  renameMedia,
  uploadMedia,
  usageItemPath,
  type MediaItem,
  type MediaUsage,
} from "@/lib/media";

type DialogState =
  | { kind: "rename"; item: MediaItem }
  | { kind: "usage"; item: MediaItem }
  | { kind: "delete"; item: MediaItem }
  | null;

/** Where a file is used, as a list the seller can follow. Used by the usage dialog and by the refused delete. */
export function UsageList({ usage }: { usage: MediaUsage }) {
  const href = useStoreHref();
  if (usage.features.length === 0) return <p className="text-sm text-muted-foreground">This file is not used anywhere.</p>;
  return (
    <ul className="flex max-h-64 flex-col gap-3 overflow-y-auto text-sm">
      {usage.features.map((feature) => (
        <li key={feature.key}>
          <p className="font-medium">
            {feature.label} <span className="text-muted-foreground">({feature.count})</span>
          </p>
          <ul className="mt-1 flex flex-col gap-1 pl-3">
            {feature.items.map((entry) => {
              const path = usageItemPath(feature.key, entry.id);
              const label = entry.title || "Untitled";
              return (
                <li key={entry.id} className="break-words">
                  {path ? (
                    <Link href={href(path)} className="underline underline-offset-2">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
            {feature.count > feature.items.length ? <li className="text-muted-foreground">and {feature.count - feature.items.length} more</li> : null}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Thumb({ item }: { item: MediaItem }) {
  const poster = item.resourceType === "video" ? ((item as { posterUrl?: string | null }).posterUrl ?? null) : item.url;
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-muted/30">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt={item.alt} loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Film className="size-8" aria-hidden="true" />
        </div>
      )}
      {item.resourceType === "video" ? (
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">Video</span>
      ) : null}
    </div>
  );
}

/** The media library: grid of the store's files, upload, rename, where it is used, delete. */
export function MediaLibrary() {
  const storeFetch = useStoreFetch();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      const result = await fetchMediaPage(storeFetch, nextPage, 24);
      if (result.ok) {
        setItems(result.value.items);
        setPage(result.value.page);
        setTotalPages(result.value.totalPages);
        setError(null);
      } else {
        setError(result.message);
      }
      setLoading(false);
    },
    [storeFetch],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const shown = useMemo(() => filterMedia(items, search), [items, search]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let done = 0;
    for (const file of Array.from(files)) {
      const result = await uploadMedia(storeFetch, file, defaultAltFromFileName(file.name));
      if (result.ok) done += 1;
      else toast.error(`${file.name}: ${result.message}`);
    }
    if (fileInput.current) fileInput.current.value = "";
    setUploading(false);
    if (done > 0) {
      toast.success(done === 1 ? "File uploaded." : `${done} files uploaded.`);
      await load(1);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this page by name" aria-label="Search files by name" className="min-h-11 pl-9" />
        </div>
        <div>
          <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" className="sr-only" id="media-upload" onChange={(e) => void onFiles(e.target.files)} />
          <Button type="button" variant="clay" className="min-h-11 w-full sm:w-auto" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
            {uploading ? "Uploading…" : "Upload files"}
          </Button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No files yet" description="Upload pictures here, then use them in your products, store settings and blog." />
      ) : shown.length === 0 ? (
        <EmptyState title="No file matches" description="Try another name." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {shown.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-col gap-2 rounded-xl border p-2">
              <Thumb item={item} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={mediaDisplayName(item)}>
                  {mediaDisplayName(item)}
                </p>
                <p className="text-xs text-muted-foreground">{formatFileSize(item.filesize)}</p>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Rename ${mediaDisplayName(item)}`} onClick={() => setDialog({ kind: "rename", item })}>
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Where ${mediaDisplayName(item)} is used`} onClick={() => setDialog({ kind: "usage", item })}>
                  <ListTree className="size-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-11 text-destructive" aria-label={`Delete ${mediaDisplayName(item)}`} onClick={() => setDialog({ kind: "delete", item })}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button type="button" variant="outline" className="min-h-11" disabled={page >= totalPages || loading} onClick={() => void load(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}

      <MediaDialogs
        state={dialog}
        onClose={() => setDialog(null)}
        onRenamed={(updated) => setItems((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))}
        onDeleted={(id) => {
          setItems((current) => current.filter((item) => item.id !== id));
          toast.success("File deleted.");
        }}
      />
    </div>
  );
}

function MediaDialogs({
  state,
  onClose,
  onRenamed,
  onDeleted,
}: {
  state: DialogState;
  onClose: () => void;
  onRenamed: (item: MediaItem) => void;
  onDeleted: (id: string) => void;
}) {
  const storeFetch = useStoreFetch();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [usage, setUsage] = useState<MediaUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const item = state?.item ?? null;
  const kind = state?.kind ?? null;

  useEffect(() => {
    setProblem(null);
    setUsage(null);
    setName(item ? mediaDisplayName(item) : "");
    if (kind !== "usage" || !item) return;
    let cancelled = false;
    setUsageLoading(true);
    void fetchMediaUsage(storeFetch, item.id).then((result) => {
      if (cancelled) return;
      setUsageLoading(false);
      if (result.ok) setUsage(result.value);
      else setProblem(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, item, storeFetch]);

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    if (!item) return;
    setBusy(true);
    const result = await renameMedia(storeFetch, item.id, name);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    onRenamed(result.value);
    toast.success("File renamed.");
    onClose();
  }

  async function confirmDelete() {
    if (!item) return;
    setBusy(true);
    const result = await deleteMedia(storeFetch, item.id);
    setBusy(false);
    if (result.ok) {
      onDeleted(item.id);
      onClose();
      return;
    }
    // A file that is still used is refused (409) and says where: show those places instead of deleting.
    setProblem(result.message);
    if (result.usage) setUsage(result.usage);
  }

  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        {kind === "rename" && item ? (
          <form onSubmit={submitRename} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Rename file</DialogTitle>
              <DialogDescription>The name is only for you. The picture and its address do not change.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="media-name">Name</Label>
              <Input id="media-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={MEDIA_NAME_MAX} className="min-h-11" autoFocus />
              {problem ? (
                <p role="alert" className="text-xs text-destructive">
                  {problem}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="clay" className="min-h-11" disabled={busy || name.trim() === ""}>
                {busy ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {kind === "usage" && item ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Where it is used</DialogTitle>
              <DialogDescription className="break-words">{mediaDisplayName(item)}</DialogDescription>
            </DialogHeader>
            {usageLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : null}
            {problem ? (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : null}
            {usage ? <UsageList usage={usage} /> : null}
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {kind === "delete" && item ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Delete this file?</DialogTitle>
              <DialogDescription className="break-words">
                {mediaDisplayName(item)} will be removed from your library for good. A file that is still used somewhere cannot be deleted.
              </DialogDescription>
            </DialogHeader>
            {problem ? (
              <div role="alert" className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <p className="text-destructive">{problem}</p>
                {usage ? <UsageList usage={usage} /> : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
                {usage ? "Close" : "Cancel"}
              </Button>
              {usage ? null : (
                <Button type="button" variant="destructive" className="min-h-11" disabled={busy} onClick={() => void confirmDelete()}>
                  {busy ? "Deleting…" : "Delete"}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
