"use client";

import { useEffect, useState } from "react";
import { useReviewRequest } from "@markaz/storefront-data/client";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/*
 * Sprint 5 EP-21.US01.T04 (D-107, D-108): "Review your order" on the tracking page of a DELIVERED order. The order number and the phone are the
 * ones the shopper typed to find the order; they are the credential, kept in React state only. The eligibility call lists the delivered products
 * that have no review yet. A review is published at once, and what the shopper writes is plain text, shown as text.
 */
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
  const chosen = items.some((item) => item.productId === productId) ? productId : (items[0]?.productId ?? "");
  const fieldClass = "min-h-11 rounded-md border border-(--mu-border) bg-transparent px-3";

  if (!opened) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpened(true)}>
        Review your order
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review your order</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {review.status === "loading" ? <p className="text-(color:--mu-fg-muted)">Checking what you can review...</p> : null}
        {review.status === "not_found" ? <p>We could not find this order. Check the order number and phone.</p> : null}
        {review.status === "error" ? <p role="alert">{review.message}</p> : null}
        {review.status === "done" ? (
          <Alert role="status">
            <p className="font-semibold">Thank you!</p>
            <p className="mt-1">Your review is live on the product page.</p>
          </Alert>
        ) : null}
        {review.eligibility && !review.eligibility.eligible && review.status !== "done" ? <p>{INELIGIBLE[review.eligibility.reason ?? "nothing_to_review"]}</p> : null}

        {review.eligibility?.eligible ? (
          <form
            className="flex flex-col gap-4"
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
              <span className="font-medium">Item</span>
              <select className={fieldClass} value={chosen} onChange={(event) => setProductId(event.target.value)}>
                {items.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.productTitle}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-1">
              <legend className="font-medium">Your rating</legend>
              <div className="flex items-center gap-1 text-2xl" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    role="radio"
                    aria-checked={rating === star}
                    aria-label={star + " out of 5"}
                    onClick={() => setRating(star)}
                    className={"size-11 leading-none " + (star <= rating ? "text-amber-500" : "text-(color:--mu-fg-muted)")}
                  >
                    ★
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Your name (shown with the review)</span>
              <input className={fieldClass} maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Title (optional)</span>
              <input className={fieldClass} maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Your review</span>
              <textarea className="rounded-md border border-(--mu-border) bg-transparent p-3" rows={4} required minLength={5} maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            {review.message ? <p role="alert">{review.message}</p> : null}
            <Button type="submit" disabled={chosen === "" || body.trim().length < 5 || review.status === "submitting"}>
              {review.status === "submitting" ? "Sending" : "Publish review"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
