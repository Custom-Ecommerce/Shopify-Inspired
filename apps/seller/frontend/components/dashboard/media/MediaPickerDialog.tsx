"use client";

import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { fetchMediaPage, mediaDisplayName, type MediaItem } from "@/lib/media";

/**
 * Sprint 7 (S7-B2): choose a picture from the store's media library (the cover of an article, or an image to put in its text). Images only: a video
 * cannot be a cover. Nothing is uploaded here; the Media page does that.
 */
export function MediaPickerDialog({
  open,
  onOpenChange,
  onPick,
  title = "Choose a picture",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: MediaItem) => void;
  title?: string;
}) {
  const storeFetch = useStoreFetch();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setProblem(null);
    void fetchMediaPage(storeFetch, 1, 48).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setItems(result.value.items.filter((item) => item.resourceType !== "video"));
      else setProblem(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [open, storeFetch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pictures from your media library. Upload new ones on the Media page.</DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        {!loading && !problem && items.length === 0 ? <p className="text-sm text-muted-foreground">Your library has no pictures yet.</p> : null}
        <ul className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <Button type="button" variant="ghost" className="h-auto min-h-11 w-full flex-col gap-1 p-1" onClick={() => { onPick(item); onOpenChange(false); }}>
                <span className="relative block aspect-square w-full overflow-hidden rounded-md border bg-muted/30">
                  {item.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt={item.alt} loading="lazy" className="size-full object-cover" />
                  ) : (
                    <Film className="m-auto size-6" aria-hidden="true" />
                  )}
                </span>
                <span className="w-full truncate text-xs">{mediaDisplayName(item)}</span>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
