import { readChoice, readPage, readSearch } from "@/lib/list-state";
import { PAGE_SIZE } from "@/lib/stores";

export const COMMISSION_VIEWS = ["ledger", "rates"] as const;
export type CommissionView = (typeof COMMISSION_VIEWS)[number];

export const VIEW_LABELS: Record<CommissionView, string> = { ledger: "Ledger", rates: "Store rates" };

export const LEDGER_STATUS_VALUES = ["pending", "settled"] as const;
export type LedgerStatusValue = (typeof LEDGER_STATUS_VALUES)[number];

export const LEDGER_STATUS_LABELS: Record<LedgerStatusValue | "refunded", string> = { pending: "Pending", settled: "Settled", refunded: "Refunded" };

export const RATE_MODE_VALUES = ["inherit", "custom"] as const;
export type RateModeValue = (typeof RATE_MODE_VALUES)[number];

export const RATE_MODE_LABELS: Record<RateModeValue, string> = { inherit: "Platform default", custom: "Custom rate" };

export const PAYMENT_METHOD_LABELS: Record<string, string> = { card: "Card", cod: "Cash on delivery" };

/**
 * The state of the commission page, held in the URL. The ledger uses status; the rates view uses mode. A value that
 * belongs to the other view is dropped, so switching views never carries a stale filter.
 */
export interface CommissionListState {
  view: CommissionView;
  page: number;
  q: string;
  status: LedgerStatusValue | "";
  mode: RateModeValue | "";
}

type Params = { get(name: string): string | null };

function readOptional<T extends string>(params: Params, name: string, allowed: readonly T[]): T | "" {
  const raw = params.get(name) ?? "";
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : "";
}

export function parseCommissionState(params: Params): CommissionListState {
  const view = readChoice(params, "view", COMMISSION_VIEWS, "ledger");
  return {
    view,
    page: readPage(params),
    q: readSearch(params),
    status: view === "ledger" ? readOptional(params, "status", LEDGER_STATUS_VALUES) : "",
    mode: view === "rates" ? readOptional(params, "mode", RATE_MODE_VALUES) : "",
  };
}

/** The query string for the page URL. The default view and empty filters are left out. */
export function commissionStateToUrl(state: CommissionListState): string {
  const params = new URLSearchParams();
  if (state.view !== "ledger") params.set("view", state.view);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (state.view === "ledger" && state.status !== "") params.set("status", state.status);
  if (state.view === "rates" && state.mode !== "") params.set("mode", state.mode);
  return params.toString();
}

/** The query string for /api/commission/ledger. The backend call adds the page size. */
export function ledgerStateToQuery(state: CommissionListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (state.status !== "") params.set("status", state.status);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

/** The query string for /api/commission/rates. */
export function ratesStateToQuery(state: CommissionListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (state.mode !== "") params.set("mode", state.mode);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

export function entryCountLabel(count: number): string {
  return count + (count === 1 ? " entry" : " entries");
}
