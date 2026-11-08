"use client";

import { Heart } from "lucide-react";
import { canFavourite } from "@markaz/storefront-data";
import { useFavourites } from "@markaz/storefront-data/client";

/** The heart. Hidden on a product shown with a preview label, so a preview never writes to a shopper's list. */
export function FavouriteButton({
  productId,
  title,
  previewLabel,
  className = "",
}: {
  productId: string;
  title: string;
  previewLabel?: string | null;
  className?: string;
}) {
  const { isFavourite, toggle } = useFavourites();
  if (!canFavourite(previewLabel)) return null;
  const saved = isFavourite(productId);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
      onClick={() => toggle(productId)}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-(--surface-elevated)/90 text-[var(--featured-text)] shadow-sm transition-transform active:scale-95 ${className}`}
    >
      <Heart className="h-4 w-4" strokeWidth={1.5} fill={saved ? "currentColor" : "none"} />
    </button>
  );
}
