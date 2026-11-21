"use client";

import type { SellerReview } from "@markaz/contracts";
import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Sprint 5 EP-21.US02 (D-107, D-108): the store's reviews. approved = shown on the storefront, rejected = hidden by an admin (the seller cannot
 * change that: only the reply is the seller's). One card per review, made for a 375 px phone: the rating, the shopper's words (plain text, React
 * escapes it), the product, and the reply box. The status tabs send ?status= (they used to send where[status][equals], which the backend never
 * read, so they did nothing).
 */
type Filter = "all" | "approved" | "rejected" | "unanswered";
const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unanswered", label: "Needs a reply" },
  { value: "approved", label: "Shown" },
  { value: "rejected", label: "Hidden" },
];
const REPLY_MAX = 500;

function filterQuery(filter: Filter): string {
  if (filter === "all") return "";
  return filter === "unanswered" ? "&unanswered=1" : `&status=${filter}`;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="whitespace-nowrap text-base leading-none" role="img" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < rating ? "text-warning" : "text-muted-foreground/40"} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

async function messageOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: Array<{ message?: unknown }> };
    const message = body.errors?.[0]?.message;
    if (typeof message === "string" && message !== "") return message;
  } catch {
    // The generic text below.
  }
  return "Could not save the reply. Please try again.";
}

function ReviewCard({ review, onChanged }: { review: SellerReview; onChanged: (updated: SellerReview) => void }) {
  const storeFetch = useStoreFetch();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const replied = review.reply !== null;
  const showBox = !replied || editing;

  async function save() {
    const trimmed = text.trim();
    if (trimmed === "") {
      setProblem("Write a reply first.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await storeFetch(replied ? `/api/dashboard/reviews/${review.id}` : `/api/dashboard/reviews/${review.id}/reply`, {
        method: replied ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: trimmed }),
      });
      if (!res.ok) {
        setProblem(await messageOf(res));
        return;
      }
      onChanged((await res.json()) as SellerReview);
      setEditing(false);
    } catch {
      setProblem("Could not reach the backend. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border bg-card p-4 text-card-foreground" aria-label={`Review by ${review.displayName}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Stars rating={review.rating} />
        <span className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleDateString()}</span>
      </div>
      {review.status === "rejected" ? (
        <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-foreground">
          Hidden by Markazify{review.hiddenReason ? `: ${review.hiddenReason}` : "."} Shoppers no longer see it.
        </p>
      ) : null}
      {review.title ? <h3 className="mt-2 break-words text-sm font-semibold">{review.title}</h3> : null}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{review.body}</p>
      <p className="mt-2 break-words text-xs text-muted-foreground">
        {review.displayName}
        {review.verified ? " · Verified buyer" : ""} · {review.product.title ?? "A product"}
      </p>

      <div className="mt-3 border-t pt-3">
        {replied && !editing ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your reply</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{review.reply?.text}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2 min-h-11 w-full sm:w-auto" onClick={() => setEditing(true)}>
              Edit reply
            </Button>
          </div>
        ) : null}
        {showBox ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`reply-${review.id}`} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {replied ? "Edit your reply" : "Reply to this review"}
            </label>
            <Textarea
              id={`reply-${review.id}`}
              rows={3}
              maxLength={REPLY_MAX}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-invalid={problem !== null}
              placeholder="Thank the shopper, or say what you will do."
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {text.length}/{REPLY_MAX}
              </span>
              {problem ? (
                <span role="alert" className="text-destructive">
                  {problem}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={save} disabled={busy}>
                {busy ? "Saving..." : replied ? "Save reply" : "Send reply"}
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 w-full sm:w-auto"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setText(review.reply?.text ?? "");
                    setProblem(null);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function DashboardReviewsPage() {
  const storeFetch = useStoreFetch();
  const [reviews, setReviews] = useState<SellerReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(() => {
    setIsLoading(true);
    setErrorMessage(null);
    storeFetch(`/api/dashboard/reviews?limit=100${filterQuery(filter)}`)
      .then((res) => {
        if (!res.ok) throw new Error("not ok");
        return res.json();
      })
      .then((data: PayloadFindResponse<SellerReview>) => setReviews(data.docs ?? []))
      .catch(() => setErrorMessage("Could not reach the backend."))
      .finally(() => setIsLoading(false));
  }, [filter, storeFetch]);

  useEffect(load, [load]);

  function replaceReview(updated: SellerReview) {
    setReviews((current) => current.map((review) => (review.id === updated.id ? updated : review)));
  }

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Reviews" />

      <Tabs
        value={filter}
        onValueChange={(v) => {
          if (v) setFilter(v as Filter);
        }}
        className="mb-6"
      >
        <TabsList variant="line" className="flex-wrap">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {errorMessage ? (
        <ErrorState message={errorMessage} onRetry={load} className="mb-6" />
      ) : isLoading ? (
        <LoadingState />
      ) : reviews.length === 0 ? (
        <EmptyState title="No reviews here" description="Shoppers can review the items of an order once it is delivered. Their reviews appear here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} onChanged={replaceReview} />
          ))}
        </div>
      )}
    </div>
  );
}
