"use client";

import React, { useEffect, useState } from "react";
import { useReviewRequest } from "@markaz/storefront-data/client";

/*
 * Sprint 5 EP-21.US01.T04 (D-107, D-108): "Review your order" on the tracking page of a DELIVERED order. The order number and the phone are the ones
 * the shopper typed to track the order: they are the credential and are kept in React state only. The eligibility call lists the delivered products
 * that have no review yet, so a product is reviewed once. A review is published at once; what the shopper writes is plain text and is shown as text.
 */
const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

const INELIGIBLE: Record<string, string> = {
  not_delivered: "You can review the items once this order has been delivered.",
  nothing_to_review: "Thank you! Every item of this order has been reviewed.",
  already_reviewed: "You have already reviewed this item.",
  unknown_product: "This item is not part of the order.",
};

export function ReviewOrder({ orderId, phone }: { orderId: string; phone: string }) {
  const review = useReviewRequest();
  const { load } = review;
  const [opened, setOpened] = useState(false);
  const [productId, setProductId] = useState("");
  const [rating, setRating] = useState(5);
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (opened) void load(orderId, phone);
  }, [opened, load, orderId, phone]);

  const items = review.eligibility?.items ?? [];
  // The first product still to review is chosen until the shopper picks another.
  const chosen = items.some((item) => item.productId === productId) ? productId : (items[0]?.productId ?? "");

  if (!opened) {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setOpened(true)}
          className="h-11 w-full rounded-lg border border-black bg-white text-xs font-bold uppercase tracking-widest text-black hover:bg-gray-100"
        >
          Review your order
        </button>
      </div>
    );
  }

  const thanks =
    review.status === "done" ? (
      <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900" role="status">
        <span className="font-bold uppercase tracking-wider">Thank you!</span> Your review is live on the product page.
      </p>
    ) : null;

  return (
    <section className="mt-5 rounded-xl border border-gray-200 p-4 text-xs" aria-label="Review your order">
      <h3 className="text-sm font-bold uppercase tracking-wider text-gray-800">Review your order</h3>
      {review.status === "loading" ? <p className="mt-2 text-gray-500">Checking what you can review...</p> : null}
      {review.status === "not_found" ? <p className="mt-2 text-rose-700">We could not find this order. Please check the order number and phone.</p> : null}
      {review.status === "error" ? <p className="mt-2 text-rose-700">{review.message}</p> : null}
      {thanks}
      {review.eligibility && !review.eligibility.eligible && review.status !== "done" ? (
        <p className="mt-2 text-gray-700">{INELIGIBLE[review.eligibility.reason ?? "nothing_to_review"]}</p>
      ) : null}
      {review.eligibility && !review.eligibility.eligible && review.status === "done" ? <p className="mt-2 text-gray-700">{INELIGIBLE.nothing_to_review}</p> : null}

      {review.eligibility?.eligible ? (
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen === "" || body.trim().length < 5) return;
            void review
              .submit({ orderId, phone, productId: chosen, rating, title: title.trim() === "" ? null : title.trim(), body, displayName: displayName.trim() === "" ? null : displayName.trim() })
              .then(() => {
                setBody("");
                setTitle("");
              });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-bold uppercase tracking-wider text-gray-800">Item</span>
            <select className="h-11 rounded-lg border border-gray-300 bg-white px-2" value={chosen} onChange={(event) => setProductId(event.target.value)}>
              {items.map((item) => (
                <option key={item.productId} value={item.productId}>
                  {item.productTitle}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="font-bold uppercase tracking-wider text-gray-800">Your rating</legend>
            <div className="flex items-center gap-1 text-2xl" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  role="radio"
                  aria-checked={rating === star}
                  aria-label={`${star} out of 5: ${RATING_WORDS[star]}`}
                  onClick={() => setRating(star)}
                  className={`size-11 leading-none ${star <= rating ? "text-amber-400" : "text-gray-300"}`}
                >
                  ★
                </button>
              ))}
              <span className="ml-1 text-xs text-gray-600">{RATING_WORDS[rating]}</span>
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="font-bold uppercase tracking-wider text-gray-800">Your name (shown with the review)</span>
            <input className="h-11 rounded-lg border border-gray-300 px-2" maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Fatima K." />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-bold uppercase tracking-wider text-gray-800">Title (optional)</span>
            <input className="h-11 rounded-lg border border-gray-300 px-2" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-bold uppercase tracking-wider text-gray-800">Your review</span>
            <textarea
              className="rounded-lg border border-gray-300 p-2"
              rows={4}
              required
              minLength={5}
              maxLength={1000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="How was the quality, the fit and the packaging?"
            />
          </label>

          {review.message ? (
            <p role="alert" className="text-rose-700">
              {review.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={chosen === "" || body.trim().length < 5 || review.status === "submitting"}
            className="h-11 w-full rounded-lg bg-black text-xs font-bold uppercase tracking-widest text-white disabled:opacity-50"
          >
            {review.status === "submitting" ? "Sending..." : "Publish review"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
