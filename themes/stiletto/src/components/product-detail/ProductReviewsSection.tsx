"use client";

import React from "react";
import Link from "next/link";
import { Star, MessageSquarePlus, CheckCircle2, Calendar } from "lucide-react";
import type { ReviewItem } from "../../model";
import { calculateReviewSummary } from "../../shared/lib/services";
import { paths } from "../../adapters/paths";

interface ProductReviewsSectionProps {
  reviews?: ReviewItem[];
  productHandle: string;
}

export function ProductReviewsSection({
  reviews = [],
  productHandle,
}: ProductReviewsSectionProps) {
  // Directly use real reviews from store normalization layer
  const displayReviews = reviews;
  const { totalReviews, averageRating } = calculateReviewSummary(displayReviews);

  return (
    <section data-source="static" data-source-note="Sample reviews. The platform has no review list yet, so every store shows the same samples." data-section="product-reviews" className="w-full py-6 my-6 border-t border-[var(--separator-border)]">
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
            <div className="flex items-center gap-1 bg-[var(--rating-badge-bg)]/80 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded border border-[var(--rating-badge-border)] text-[var(--rating-badge-text)]">
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
      {totalReviews === 0 ? (
        <div className="w-full py-8 px-4 rounded-lg border border-dashed border-[var(--separator-border)] text-center bg-[var(--surface-subtle)]/50">
          <p className="text-xs text-[var(--featured-card-muted)] uppercase tracking-wider font-medium mb-2">
            No reviews found for this product yet.
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
              className="snap-start flex-shrink-0 w-[260px] sm:w-[calc((100%-2rem)/3.3)] h-[185px] p-4 rounded-lg border border-[var(--separator-border)] bg-[var(--surface-elevated)] shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                {/* Star Rating & Date */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex gap-0.5">
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
                    <span>{rev.date}</span>
                  </div>
                </div>

                {/* Comment Text with Line Clamp 5 */}
                <p className="text-xs text-[var(--featured-text)] leading-relaxed line-clamp-5 font-sans">
                  "{rev.comment.trim()}"
                </p>
              </div>

              {/* Author Info & Verified Badge */}
              <div className="pt-2 border-t border-[var(--separator-subtle)] flex items-center justify-between text-[11px]">
                <strong className="font-semibold text-[var(--featured-text)] uppercase tracking-wider">
                  {rev.author}
                </strong>
                <div className="flex items-center gap-1 text-[10px] text-[var(--status-positive-text)] font-bold uppercase">
                  <CheckCircle2 className="w-3 h-3 text-[var(--status-positive-text)]" />
                  <span>Verified Buyer</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}