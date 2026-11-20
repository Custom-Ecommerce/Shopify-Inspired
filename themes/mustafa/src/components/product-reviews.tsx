"use client";

import { useProductReviews } from "@markaz/storefront-data/client";
import type { StorefrontProductReviews } from "@markaz/storefront-data";

/**
 * Sprint 5 EP-21.US01.T03 / T04: a product's real reviews on the Mustafa product page: the average and the count, then the newest reviews with the
 * seller's reply. Plain text, rendered as text. A product with no reviews shows a short empty state (a review is written from the tracking page of
 * a delivered order).
 */
export function ProductReviews({ slug, initialReviews }: { slug: string; initialReviews?: StorefrontProductReviews | null }) {
  const { reviews: data } = useProductReviews(slug, initialReviews);
  const { count, average } = data.summary;
  return (
    <section aria-label="Customer reviews" className="mx-auto w-full max-w-6xl px-4 py-8">
      <h2 className="text-xl font-semibold">
        Customer reviews{count > 0 ? ` (${count}) · ${average.toFixed(1)} out of 5` : ""}
      </h2>
      {count === 0 || data.reviews.length === 0 ? (
        <p className="mt-2 text-sm text-(color:--mu-fg-muted)">No reviews for this product yet. Once your order is delivered you can review it from the Track order page.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {data.reviews.map((review) => (
            <li key={review.id} className="rounded-md border border-(--mu-border) p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span role="img" aria-label={review.rating + " out of 5"} className="text-amber-500">
                  {"★".repeat(review.rating)}
                  <span className="text-(color:--mu-fg-muted)">{"★".repeat(5 - review.rating)}</span>
                </span>
                <span className="text-xs text-(color:--mu-fg-muted)">{new Date(review.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
              </div>
              {review.title ? <p className="mt-2 break-words font-semibold">{review.title}</p> : null}
              <p className="mt-1 whitespace-pre-line break-words">{review.body}</p>
              <p className="mt-2 text-xs text-(color:--mu-fg-muted)">
                {review.displayName}
                {review.verified ? " · Verified buyer" : ""}
              </p>
              {review.reply ? (
                <p className="mt-2 border-l-2 border-(--mu-border) pl-3 text-xs">
                  <span className="font-semibold">Seller reply:</span> {review.reply.text}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
