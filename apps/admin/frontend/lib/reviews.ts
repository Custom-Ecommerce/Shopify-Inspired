import type { ModerationReview } from "@markaz/contracts";

/** Sprint 5 EP-21.US01.T05 (D-108): the admin's review list and its two actions. */

export const REVIEW_PAGE_SIZE = 20;
export const REVIEW_STATUS_VALUES = ["approved", "rejected"] as const;
export type ReviewStatusFilter = (typeof REVIEW_STATUS_VALUES)[number];
export const REVIEW_HIDE_REASON_MIN = 3;
export const REVIEW_HIDE_REASON_MAX = 300;

export interface ReviewListState {
  page: number;
  status: ReviewStatusFilter | "";
  storeId: string;
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Anything unreadable falls back to the default, so a hand-edited URL never breaks the page. */
export function parseReviewListState(params: { get(name: string): string | null }): ReviewListState {
  const rawPage = params.get("page") ?? "";
  const page = /^\d{1,6}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  const rawStatus = params.get("status") ?? "";
  const status = REVIEW_STATUS_VALUES.find((value) => value === rawStatus) ?? "";
  const rawStore = (params.get("storeId") ?? "").trim();
  return { page, status, storeId: OBJECT_ID.test(rawStore) ? rawStore : "" };
}

/** The query string for a list state. Defaults are left out. */
export function reviewStateToQuery(state: ReviewListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.status !== "") params.set("status", state.status);
  if (state.storeId !== "") params.set("storeId", state.storeId);
  if (withLimit) params.set("limit", String(REVIEW_PAGE_SIZE));
  return params.toString();
}

export type ReviewAction = "hide" | "unhide";

/** A shown review can be hidden; a hidden one can be shown again. (A review left pending by older data can be hidden too.) */
export function availableReviewAction(review: Pick<ModerationReview, "status">): ReviewAction {
  return review.status === "rejected" ? "unhide" : "hide";
}

export const REVIEW_COPY: Record<ReviewAction, { button: string; title: string; hint: string; confirm: string; done: string; needsReason: boolean }> = {
  hide: {
    button: "Hide",
    title: "Hide this review",
    hint: "It leaves the store and the product's rating at once. The seller can still read it and your reason.",
    confirm: "Hide review",
    done: "Review hidden",
    needsReason: true,
  },
  unhide: {
    button: "Unhide",
    title: "Show this review again",
    hint: "It returns to the store and counts in the product's rating again.",
    confirm: "Show review",
    done: "Review shown again",
    needsReason: false,
  },
};
