"use client";

import React from "react";
import Link from "next/link";
import { Star, MessageSquarePlus, CheckCircle2, Calendar } from "lucide-react";
import { useProductReviews } from "@markaz/storefront-data/client";
import type { StorefrontProductReviews } from "@markaz/storefront-data";
import { paths } from "../../adapters/paths";

interface ProductReviewsSectionProps {
  productHandle: string;
  /** The product's approved reviews, read on the server for a live store. Without them (the demo) the section reads them itself. */
  initialReviews?: StorefrontProductReviews | null;
}

/** "12 Mar 2026". The review's date as the shopper reads it. */
function shownDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Sprint 5 EP-21.US01.T03 / T04 (D-107): the product's REAL reviews: the approved ones, newest first, with the average and the count of all of
 * them and the seller's reply under each. It used to show three static sample reviews on every store. Review text is plain text and is rendered as
 * text (React escapes it). A product with no review yet shows the empty state and the way to write the first one.
 */
export function ProductReviewsSection({ productHandle, initialReviews }: ProductReviewsSectionProps) {
  const { reviews: data } = useProductReviews(productHandle, initialReviews);
  const displayReviews = data.reviews;
  const totalReviews = data.summary.count;
  const averageRating = data.summary.average.toFixed(1);

  return (
    <section data-source="dynamic" data-source-note="The product's own approved reviews, their average and count, and the seller's replies." data-section="product-reviews" className="w-full py-6 my-6 border-t border-[var(--separator-border)]">
      {/* Header Container */}
      <div className="flex flex-row items-center justify-between mb-6 gap-2">
        <div>
          <span className="font-sans text-[10px] sm:text-[11px] uppercase tracking-[0.15em] sm:tracking-[0.2em] font-semibold text-[var(--featured-card-muted)] block mb-0.5">
            Customer Opinions
          </span>
          {/* Typography Matched with SIMILAR PRODUCTS */}
          <h2 className="font-heading text-[22px] md:text-[30px] uppercase tracking-[0.08em] text-[var(--featured-text)] leading-none">
            Product Reviews ({totalReviews})
          </h2>
        </div>

        {/* Rating Summary & Compact Write Review Button */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
          {totalReviews > 0 && (
            <div className="flex items-center gap-1 bg-[var(--rating-badge-bg)]/80 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded border border-[var(--rating-badge-border)] text-[var(--rating-badge-text)]" aria-label={`Average rating ${averageRating} out of 5`}>
              <Star className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-[var(--rating-star-fill)] text-[var(--rating-star-fill)]" />
              <span className="text-[10px] sm:text-xs font-bold">{averageRating}</span>
            </div>
          )}

          <Link
            href={paths.feedback(productHandle)}
            className="inline-flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 bg-[var(--featured-text)] text-[var(--text-inverse)] text-[9px] sm:text-[11px] uppercase tracking-[0.06em] sm:tracking-[0.1em] font-bold rounded hover:opacity-90 transition-all active:scale-95 shadow-sm whitespace-nowrap"
          >
            <MessageSquarePlus className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" />
            <span>Write A Review</span>
          </Link>
        </div>
      </div>

      {/* Reviews Content Area */}
      {totalReviews === 0 || displayReviews.length === 0 ? (
        <div className="w-full py-8 px-4 rounded-lg border border-dashed border-[var(--separator-border)] text-center bg-[var(--surface-subtle)]/50">
          <p className="text-xs text-[var(--featured-card-muted)] uppercase tracking-wider font-medium mb-2">
            No reviews for this product yet.
          </p>
          <Link
            href={paths.feedback(productHandle)}
            className="inline-block text-xs font-bold uppercase tracking-widest text-[var(--featured-text)] underline underline-offset-4 hover:opacity-75"
          >
            Be the first to leave a review!
          </Link>
        </div>
      ) : (
        /* Carousel Horizontal Scroll Strip (SCROLLBAR HIDDEN) */
        <div className="flex gap-4 overflow-x-auto py-1 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {displayReviews.map((rev) => (
            <div
              key={rev.id}
              className="snap-start flex-shrink-0 w-[260px] sm:w-[calc((100%-2rem)/3.3)] min-h-[185px] p-4 rounded-lg border border-[var(--separator-border)] bg-[var(--surface-elevated)] shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                {/* Star Rating & Date */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex gap-0.5" role="img" aria-label={`${rev.rating} out of 5`}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-3.5 h-3.5 ${
                          s <= rev.rating
                            ? "fill-[var(--rating-star-fill)] text-[var(--rating-star-fill)]"
                            : "text-[var(--rating-star-empty)] fill-[var(--rating-star-empty)]"
                        }`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-1 text-[10px] text-[var(--featured-card-muted)] font-sans">
                    <Calendar className="w-3 h-3 text-[var(--icon-muted)]" />
                    <span>{shownDate(rev.createdAt)}</span>
                  </div>
                </div>

                {rev.title ? <p className="mb-1 text-xs font-bold text-[var(--featured-text)] break-words">{rev.title}</p> : null}
                {/* Comment Text with Line Clamp 5 */}
                <p className="text-xs text-[var(--featured-text)] leading-relaxed line-clamp-5 font-sans whitespace-pre-line break-words">
                  &ldquo;{rev.body}&rdquo;
                </p>

                {rev.reply ? (
                  <p className="mt-2 border-l-2 border-[var(--separator-border)] pl-2 text-[11px] text-[var(--featured-card-muted)] line-clamp-3 break-words">
                    <strong className="font-semibold text-[var(--featured-text)]">Seller reply:</strong> {rev.reply.text}
                  </p>
                ) : null}
              </div>

              {/* Author Info & Verified Badge */}
              <div className="pt-2 mt-2 border-t border-[var(--separator-subtle)] flex items-center justify-between gap-2 text-[11px]">
                <strong className="font-semibold text-[var(--featured-text)] uppercase tracking-wider truncate">
                  {rev.displayName}
                </strong>
                {rev.verified ? (
                  <div className="flex items-center gap-1 text-[10px] text-[var(--status-positive-text)] font-bold uppercase shrink-0">
                    <CheckCircle2 className="w-3 h-3 text-[var(--status-positive-text)]" />
                    <span>Verified Buyer</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
