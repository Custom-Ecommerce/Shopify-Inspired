"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ModerationReview } from "@markaz/contracts";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listModerationReviews, runReviewAction } from "@/lib/api/client";
import { formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import {
  REVIEW_COPY,
  REVIEW_HIDE_REASON_MAX,
  REVIEW_HIDE_REASON_MIN,
  REVIEW_STATUS_VALUES,
  availableReviewAction,
  parseReviewListState,
  reviewStateToQuery,
  type ReviewAction,
  type ReviewListState,
} from "@/lib/reviews";

/**
 * The cross-store review list at /reviews (Sprint 5 EP-21.US01.T05, D-108). An operator can hide a review with a reason or show a hidden one again.
 * The text is shown as plain text (React escapes it). Nothing about the shopper but the name they chose to show is here.
 */
export function ReviewsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseReviewListState(searchParams), [searchParams]);
  const [intent, setIntent] = useState<{ action: ReviewAction; review: ModerationReview } | null>(null);

  const go = useCallback(
    (next: ReviewListState) => {
      const query = reviewStateToQuery(next);
      router.replace(query === "" ? pathname : pathname + "?" + query);
    },
    [router, pathname],
  );

  const { data, error, loading, refetch } = useAdminFetch((signal) => listModerationReviews(state, signal), [state.page, state.status, state.storeId]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const columns: Array<Column<ModerationReview>> = [
    {
      key: "review",
      header: "Review",
      cell: (review) => (
        <div className="flex min-w-0 max-w-xs flex-col gap-0.5 xl:max-w-md">
          <span className="text-sm font-medium" aria-label={review.rating + " out of 5"}>
            {"★".repeat(review.rating)}
            {"☆".repeat(5 - review.rating)}
          </span>
          {review.title ? <span className="break-words text-sm font-medium">{review.title}</span> : null}
          <span className="line-clamp-3 break-words text-sm">{review.body}</span>
          <span className="truncate text-xs text-muted-foreground">
            {review.displayName} · {review.productTitle ?? "a product"}
          </span>
        </div>
      ),
    },
    {
      key: "store",
      header: "Store",
      className: "hidden md:table-cell",
      cell: (review) => (
        <button type="button" className="block max-w-32 truncate text-left text-primary underline-offset-4 hover:underline xl:max-w-48" onClick={() => go({ ...state, storeId: review.storeId, page: 1 })}>
          {review.storeName ?? review.storeId}
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (review) => (
        <div className="flex min-w-0 flex-col gap-1">
          <StatusBadge status={review.status === "rejected" ? "takedown" : "live"} label={review.status === "rejected" ? "Hidden" : "Shown"} />
          {review.hiddenReason ? <span className="break-words text-xs text-muted-foreground">{review.hiddenReason}</span> : null}
        </div>
      ),
    },
    { key: "date", header: "Written", className: "hidden xl:table-cell", cell: (review) => <span className="text-muted-foreground">{formatRelative(review.createdAt)}</span> },
    {
      key: "actions",
      header: "Actions",
      cell: (review) => {
        const action = availableReviewAction(review);
        return (
          <Button variant="outline" size="sm" onClick={() => setIntent({ action, review })}>
            {REVIEW_COPY[action].button}
          </Button>
        );
      },
    },
  ];

  const filtered = state.status !== "" || state.storeId !== "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Reviews</h2>
        <p className="text-sm text-muted-foreground">Every review on the platform. You can hide one with a reason or show it again, but not edit it.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row" role="search">
        <Select aria-label="Filter by status" className="sm:w-48" value={state.status} onChange={(event) => go({ ...state, status: event.target.value as ReviewListState["status"], page: 1 })}>
          <option value="">All reviews</option>
          {REVIEW_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {status === "approved" ? "Shown" : "Hidden"}
            </option>
          ))}
        </Select>
        {state.storeId !== "" ? (
          <Button variant="outline" onClick={() => go({ ...state, storeId: "", page: 1 })}>
            All stores
          </Button>
        ) : null}
      </div>

      <DataTable
        label="Reviews"
        columns={columns}
        rows={data?.docs ?? []}
        rowKey={(review) => review.reviewId}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No reviews match" : "No reviews yet"}
        emptyHint={filtered ? "Try a different filter." : "Reviews appear here as shoppers write them."}
      />

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="review" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}

      {intent !== null ? (
        <ReviewDialog
          key={intent.action + intent.review.reviewId}
          action={intent.action}
          review={intent.review}
          onClose={() => setIntent(null)}
          onDone={() => {
            setIntent(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}

/** One action on one review: what it does, a reason when hiding, and an explicit confirm. */
function ReviewDialog({ action, review, onClose, onDone }: { action: ReviewAction; review: ModerationReview; onClose: () => void; onDone: () => void }) {
  const copy = REVIEW_COPY[action];
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = useCallback((input: { reason: string }) => runReviewAction(action, review.reviewId, input.reason), [action, review.reviewId]);
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (copy.needsReason && trimmed.length < REVIEW_HIDE_REASON_MIN) {
      setFieldError("Give a reason of at least " + REVIEW_HIDE_REASON_MIN + " characters.");
      return;
    }
    setFieldError(null);
    const result = await mutation.run({ reason: trimmed });
    if (result === null) return;
    toast.success(copy.done);
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title={copy.title} description={"A review of " + (review.productTitle ?? "a product") + " in " + (review.storeName ?? "an unnamed store")} busy={mutation.pending}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">{copy.hint}</p>
        {copy.needsReason ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="review-reason">Reason (required)</Label>
            <Textarea
              id="review-reason"
              autoFocus
              required
              rows={3}
              maxLength={REVIEW_HIDE_REASON_MAX}
              value={reason}
              aria-invalid={fieldError !== null}
              onChange={(event) => setReason(event.target.value)}
            />
            {fieldError !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {fieldError}
              </p>
            ) : null}
          </div>
        ) : null}
        {mutation.error ? (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={action === "hide" ? "destructive" : "default"} disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {copy.confirm}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
