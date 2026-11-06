"use client";

import type { ProductVideoVM } from "@markaz/storefront-data";

/** The Videos section of the product page. preload="none": a page with four videos downloads nothing until one is played. */
export function ProductVideos({ videos, title }: { videos: ProductVideoVM[]; title: string }) {
  if (videos.length === 0) return null;
  return (
    <section data-source="dynamic" data-source-note="Videos come from the product." data-section="product-videos" className="flex flex-col gap-3">
      <h2 className="font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--featured-text)]">Videos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {videos.map((video, index) => (
          <video
            key={video.id}
            src={video.url}
            poster={video.posterUrl ?? undefined}
            controls
            playsInline
            preload="none"
            aria-label={`${title}, video ${index + 1}`}
            className="w-full rounded-md bg-[var(--featured-bg-secondary)]"
          />
        ))}
      </div>
    </section>
  );
}
