import type { AdminReferralRow } from "@markaz/contracts/admin-referrals";

/**
 * Sprint 8 (S8-B6, D-118): the wording and requests of the admin console's read-only Referrals page. Pure: no I/O. The referred seller arrives masked from the
 * server; nothing here can unmask it. Names are plain text.
 */

export const REFERRAL_STATUS_VALUES = ["pending", "rewarded", "capped", "refused"] as const;
export type ReferralStatusValue = (typeof REFERRAL_STATUS_VALUES)[number];
export type ReferralStatusFilter = ReferralStatusValue | "all";

export const REFERRAL_STATUS_LABELS: Record<ReferralStatusFilter, string> = {
  all: "All referrals",
  pending: "Pending",
  rewarded: "Rewarded",
  capped: "Monthly limit reached",
  refused: "Not eligible",
};

/** The badge tone each status borrows from the shared status badge. */
export const REFERRAL_BADGE_STATUS: Record<ReferralStatusValue, string> = { pending: "pending", rewarded: "active", capped: "draft", refused: "suspended" };

export interface ReferralListState {
  page: number;
  status: ReferralStatusFilter;
  q: string;
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: string | null): string => (value !== null && DAY.test(value) ? value : "");

/** Anything unreadable falls back to the default, so a hand-edited URL never breaks the page. */
export function parseReferralListState(params: { get(name: string): string | null }): ReferralListState {
  const rawPage = params.get("page") ?? "";
  const page = /^\d{1,4}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  const status = REFERRAL_STATUS_VALUES.find((value) => value === params.get("status")) ?? "all";
  return { page, status, q: (params.get("q") ?? "").trim().slice(0, 100), from: day(params.get("from")), to: day(params.get("to")) };
}

/** The page's own query string and the API call's: defaults are left out. */
export function referralStateToQuery(state: ReferralListState): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.status !== "all") params.set("status", state.status);
  if (state.q !== "") params.set("q", state.q);
  if (state.from !== "") params.set("from", state.from);
  if (state.to !== "") params.set("to", state.to);
  return params.toString();
}

/** The CSV of rewards for the chosen days (the days of the reward). */
export function referralExportHref(range: Pick<ReferralListState, "from" | "to">): string {
  const params = new URLSearchParams();
  if (range.from !== "") params.set("from", range.from);
  if (range.to !== "") params.set("to", range.to);
  const query = params.toString();
  return "/api/referrals/export" + (query === "" ? "" : "?" + query);
}

export const rangeProblem = (from: string, to: string): string | null => (from !== "" && to !== "" && from > to ? "The start date is after the end date." : null);

const date = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const monthsText = (row: Pick<AdminReferralRow, "status" | "months">): string =>
  row.status === "rewarded" ? `${row.months} free ${row.months === 1 ? "month" : "months"}` : "No reward";

export function datesText(row: Pick<AdminReferralRow, "createdAt" | "rewardedAt">): string {
  return "Signed up " + date(row.createdAt) + (row.rewardedAt === null ? "" : ", rewarded " + date(row.rewardedAt));
}

export const voidedText = (row: Pick<AdminReferralRow, "paymentVoidedAt">): string | null =>
  row.paymentVoidedAt === null ? null : "The payment that earned this was voided on " + date(row.paymentVoidedAt) + ". The reward was not taken back.";
