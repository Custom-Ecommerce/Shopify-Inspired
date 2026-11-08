"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { refusalMessage } from "@/lib/product-actions";

/** Local copies of MEDIA_VIDEO_* in packages/contracts, for a message before the upload. The server decides. */
const MAX_VIDEOS = 4;
const MAX_MB = 50;
const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export interface VideoEntry {
  id: string;
  url: string;
  posterUrl: string | null;
  duration: number | null;
}

function durationText(seconds: number | null): string {
  if (seconds === null) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The optional Videos section. The ordered list is the form's: this only uploads, removes and moves entries. */
export function ProductVideos({
  videos,
  alt,
  onChange,
  onBusyChange,
}: {
  videos: VideoEntry[];
  /** The alt text an upload needs. */
  alt: string;
  onChange: (update: (current: VideoEntry[]) => VideoEntry[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const storeFetch = useStoreFetch();
  const [uploading, setUploading] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Use an MP4, WebM or MOV video.");
      input.value = "";
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`A video can be at most ${MAX_MB} MB.`);
      input.value = "";
      return;
    }
    setUploading(true);
    onBusyChange(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("alt", alt || "Product video");
      const res = await storeFetch("/api/proxy/media", { method: "POST", body });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(refusalMessage(data, "Video upload failed."));
        return;
      }
      const raw = data as { doc?: unknown } | null;
      const doc = (raw?.doc ?? raw) as { id: string; url?: string; posterUrl?: string | null; duration?: number | null };
      onChange((current) => [...current, { id: doc.id, url: doc.url ?? "", posterUrl: doc.posterUrl ?? null, duration: doc.duration ?? null }]);
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setUploading(false);
      onBusyChange(false);
      input.value = "";
    }
  }

  function move(index: number, target: number) {
    onChange((current) => {
      const next = [...current];
      const [video] = next.splice(index, 1);
      if (video) next.splice(target, 0, video);
      return next;
    });
  }

  return (
    <div>
      <Label className="mb-1">Videos (optional, max {MAX_VIDEOS})</Label>
      <div className="flex gap-2 mb-2 flex-wrap">
        {videos.map((video, index) => (
          <div key={video.id} className="flex flex-col gap-1 w-24">
            <div className="relative w-24 h-24 border border-border rounded-md overflow-hidden bg-muted">
              {video.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.posterUrl} alt="" className="object-cover w-full h-full" />
              ) : null}
              <Button
                type="button"
                variant="destructive"
                size="icon"
                aria-label="Remove video"
                className="absolute top-1 right-1 rounded-full size-5 shadow-sm"
                onClick={() => onChange((current) => current.filter((entry) => entry.id !== video.id))}
              >
                <X className="size-3" />
              </Button>
              {video.duration !== null ? (
                <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-medium">{durationText(video.duration)}</span>
              ) : null}
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" size="icon" aria-label="Move video earlier" className="size-6" disabled={index === 0} onClick={() => move(index, index - 1)}>
                <ArrowLeft className="size-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Move video later" className="size-6" disabled={index === videos.length - 1} onClick={() => move(index, index + 1)}>
                <ArrowRight className="size-3" />
              </Button>
            </div>
          </div>
        ))}
        {videos.length < MAX_VIDEOS && (
          <label className="w-24 h-24 border border-dashed border-border bg-card rounded-md flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors text-center">
            <span className="text-xs text-muted-foreground">{uploading ? "Uploading..." : "+ Video"}</span>
            <input type="file" accept={ALLOWED_TYPES.join(",")} className="hidden" onChange={upload} disabled={uploading} />
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">MP4, WebM or MOV, up to {MAX_MB} MB and 60 seconds each.</p>
    </div>
  );
}
