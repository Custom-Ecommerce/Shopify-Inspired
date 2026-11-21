import type { ModerationReview, ModerationReviewList } from "@markaz/contracts";
import { reviewStateToQuery, type ReviewAction, type ReviewListState } from "@/lib/reviews";
import { paymentApiQuery, type PaymentAction, type PaymentListState } from "@/lib/subscription-payments";
import { orderStateToQuery, type OrderListState } from "@/lib/orders";
import {
  adminStoreDetailSchema,
  adminStoreListEnvelopeSchema,
  storeStatusChangeResponseSchema,
  type AdminStoreDetail,
  type AdminStoreListEnvelope,
  type StoreStatusChangeRequest,
  type StoreStatusChangeResponse,
  adminSellerListEnvelopeSchema,
  adminSellerStatusResponseSchema,
  adminSellerStoreLimitSchema,
  adminSellerStoreLimitSetResponseSchema,
  type AdminSellerStatusResponse,
  type AdminSellerStoreLimit,
  type AdminSellerStoreLimitSetResponse,
  adminSyncOutboxSchema,
  adminAuditListSchema,
  type AdminSellerListEnvelope,
  type AdminSyncOutbox,
  type AdminAuditList,
  adminLedgerListSchema,
  adminCommissionRatesSchema,
  adminSubscriptionPlanListSchema,
  adminPaymentListSchema,
  adminOrderListSchema,
  adminOrderDetailResponseSchema,
  type AdminOrderList,
  type AdminOrderDetail,
  adminPaymentWriteResponseSchema,
  type AdminPaymentList,
  type AdminPaymentWriteResponse,
  type AdminLedgerList,
  type AdminCommissionRates,
  type AdminSubscriptionPlanList,
} from "@/lib/contracts";
import { auditStateToQuery, type AuditListState } from "@/lib/audit";
import { sellerStateToQuery, type SellerListState } from "@/lib/sellers";
import { syncStateToQuery, type SyncListState } from "@/lib/sync";
import { listStateToQuery, type StoreListState } from "@/lib/stores";
import { ledgerStateToQuery, ratesStateToQuery, type CommissionListState } from "@/lib/commission";
import { subscriptionStateToQuery, type SubscriptionListState } from "@/lib/subscriptions";
import { adminOverviewSchema, adminPlanWriteResponseSchema, adminSellerPlansResponseSchema, type AdminOverview, type AdminPlanWriteResponse, type AdminSellerPlansResponse } from "@/lib/contracts";
import {
  commissionReportSchema,
  payoutBalanceListSchema,
  payoutFullDetailsSchema,
  payoutListSchema,
  payoutRowSchema,
  type CommissionReport,
  type PayoutBalanceList,
  type PayoutFullDetails,
  type PayoutList,
  type PayoutRow,
} from "@/lib/contracts";
import { reportQuery, type ReportPeriodValue } from "@/lib/payouts";
import { historyParser, loose, type RateHistoryList } from "@/lib/commission-rates";
import {
  moderationPermanentDeleteResponseSchema,
  moderationProductListSchema,
  moderationProductSchema,
  type ModerationPermanentDeleteResponse,
  type ModerationProduct,
  type ModerationProductList,
} from "@/lib/contracts";
import { productStateToQuery, type ModerationAction, type ProductListState } from "@/lib/products";
import {
  adminPlatformSettingsSchema,
  adminSettingsUpdateResponseSchema,
  type AdminPlatformSettings,
  type AdminSettingsUpdateRequest,
  type AdminSettingsUpdateResponse,
} from "@/lib/contracts";

/** A failed call, with the HTTP status the console's proxy answered and the backend's message. */
export class ApiError extends Error {
  readonly status: number;
  readonly issues: Array<{ path: string; message: string }>;

  constructor(status: number, message: string, issues: Array<{ path: string; message: string }> = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

const FALLBACK: Record<number, string> = {
  401: "Your session has expired. Sign in again.",
  403: "You do not have permission to do that.",
  404: "Not found.",
  409: "The store was changed by someone else. Reload and try again.",
  422: "Check the details and try again.",
  503: "The admin service is unavailable. Try again shortly.",
};

async function call<T>(url: string, parser: Parser<T>, init: RequestInit = {}, pick: (payload: unknown) => unknown = (p) => p): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    response = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ApiError(0, "Could not reach the console. Check your connection.");
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : (FALLBACK[response.status] ?? "Something went wrong. Try again.");
    const issues = Array.isArray(payload?.issues) ? (payload.issues as Array<{ path: string; message: string }>) : [];
    throw new ApiError(response.status, message, issues);
  }
  const parsed = parser.safeParse(pick(payload));
  if (!parsed.success) throw new ApiError(502, "The admin service answered with an unexpected shape.");
  return parsed.data;
}

export function listStores(state: StoreListState, signal?: AbortSignal): Promise<AdminStoreListEnvelope> {
  return call("/api/stores?" + listStateToQuery(state, true), adminStoreListEnvelopeSchema as Parser<AdminStoreListEnvelope>, { signal });
}

export function getStore(id: string, signal?: AbortSignal): Promise<AdminStoreDetail> {
  return call("/api/stores/" + encodeURIComponent(id), adminStoreDetailSchema as Parser<AdminStoreDetail>, { signal }, (p) => (p as { store?: unknown } | null)?.store);
}

export function changeStoreStatus(id: string, input: StoreStatusChangeRequest): Promise<StoreStatusChangeResponse> {
  return call("/api/stores/" + encodeURIComponent(id) + "/status", storeStatusChangeResponseSchema as Parser<StoreStatusChangeResponse>, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listModerationProducts(state: ProductListState, signal?: AbortSignal): Promise<ModerationProductList> {
  return call("/api/products?" + productStateToQuery(state, true), moderationProductListSchema as Parser<ModerationProductList>, { signal });
}

/** One moderation action. A restore carries no reason. */
export function runModerationAction(action: ModerationAction, productId: string, reason: string): Promise<ModerationProduct | ModerationPermanentDeleteResponse> {
  const init = { method: "POST", body: JSON.stringify(action === "restore" ? { productId } : { productId, reason }) };
  const url = "/api/products/" + action;
  if (action === "permanent-delete") return call(url, moderationPermanentDeleteResponseSchema as Parser<ModerationPermanentDeleteResponse>, init);
  return call(url, moderationProductSchema as Parser<ModerationProduct>, init);
}

export function listSellers(state: SellerListState, signal?: AbortSignal): Promise<AdminSellerListEnvelope> {
  return call("/api/sellers?" + sellerStateToQuery(state, true), adminSellerListEnvelopeSchema as Parser<AdminSellerListEnvelope>, { signal });
}

/** Sprint 4 EP-08.US03: suspend (with a reason) or unsuspend a seller account. */
export function changeSellerStatus(id: string, input: { status: "suspended" | "active"; reason?: string }): Promise<AdminSellerStatusResponse> {
  return call("/api/sellers/" + encodeURIComponent(id) + "/status", adminSellerStatusResponseSchema as Parser<AdminSellerStatusResponse>, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Sprint 6 EP-12.US02.T03: a seller's store limit: the override, the effective limit and where it comes from. */
export function getSellerStoreLimit(id: string, signal?: AbortSignal): Promise<AdminSellerStoreLimit> {
  return call("/api/sellers/" + encodeURIComponent(id) + "/store-limit", adminSellerStoreLimitSchema as Parser<AdminSellerStoreLimit>, { signal });
}

/** Sprint 6 EP-12.US02.T02: set (a whole number from 1) or clear (null) a seller's store-limit override, with a reason. */
export function setSellerStoreLimit(id: string, input: { storeLimitOverride: number | null; reason: string }): Promise<AdminSellerStoreLimitSetResponse> {
  return call("/api/sellers/" + encodeURIComponent(id) + "/store-limit", adminSellerStoreLimitSetResponseSchema as Parser<AdminSellerStoreLimitSetResponse>, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getSyncOutbox(state: SyncListState, signal?: AbortSignal): Promise<AdminSyncOutbox> {
  return call("/api/sync/outbox?" + syncStateToQuery(state, true), adminSyncOutboxSchema as Parser<AdminSyncOutbox>, { signal });
}

export function listAudit(state: AuditListState, signal?: AbortSignal): Promise<AdminAuditList> {
  return call("/api/audit?" + auditStateToQuery(state, true), adminAuditListSchema as Parser<AdminAuditList>, { signal });
}

export function listCommissionLedger(state: CommissionListState, signal?: AbortSignal): Promise<AdminLedgerList> {
  return call("/api/commission/ledger?" + ledgerStateToQuery(state, true), adminLedgerListSchema as Parser<AdminLedgerList>, { signal });
}

export function listCommissionRates(state: CommissionListState, signal?: AbortSignal): Promise<AdminCommissionRates> {
  return call("/api/commission/rates?" + ratesStateToQuery(state, true), adminCommissionRatesSchema as Parser<AdminCommissionRates>, { signal });
}

/** Sprint 4 EP-05.US02: sets (rate) or clears (rate null) a store's custom commission rate. A reason is required. */
export function changeStoreRate(id: string, input: { rate: number | null; reason: string }): Promise<Record<string, unknown>> {
  const url = "/api/commission/stores/" + encodeURIComponent(id);
  const init = input.rate === null ? { method: "DELETE", body: JSON.stringify({ reason: input.reason }) } : { method: "PUT", body: JSON.stringify(input) };
  return call(url, loose, init);
}

/** Changes the platform default commission rate. A reason is required. */
export function changeDefaultRate(input: { rate: number; reason: string }): Promise<Record<string, unknown>> {
  return call("/api/commission/default", loose, { method: "PUT", body: JSON.stringify(input) });
}

export function listRateHistory(page: number, signal?: AbortSignal): Promise<RateHistoryList> {
  return call("/api/commission/history?page=" + page, historyParser, { signal });
}

export function listSubscriptionPlans(state: SubscriptionListState, signal?: AbortSignal): Promise<AdminSubscriptionPlanList> {
  return call("/api/subscription-plans?" + subscriptionStateToQuery(state, true), adminSubscriptionPlanListSchema as Parser<AdminSubscriptionPlanList>, { signal });
}

/** Sprint 6 EP-14.US02.T08: the plan, status and usage of the sellers on the page (a failure only hides the plan column). */
export function getSellerPlans(ids: readonly string[], signal?: AbortSignal): Promise<AdminSellerPlansResponse> {
  return call("/api/sellers/plans?ids=" + ids.map(encodeURIComponent).join(","), adminSellerPlansResponseSchema as Parser<AdminSellerPlansResponse>, { signal });
}

/** Sprint 6 EP-14.US01: create a plan. The answer is the new plan (revision 0). */
export function createPlan(input: unknown): Promise<AdminPlanWriteResponse> {
  return call("/api/subscription-plans", adminPlanWriteResponseSchema as Parser<AdminPlanWriteResponse>, { method: "POST", body: JSON.stringify(input) });
}

/** Sprint 6 EP-14.US01: change a plan. The body carries the revision the admin saw and a reason. */
export function updatePlan(id: string, input: unknown): Promise<AdminPlanWriteResponse> {
  return call("/api/subscription-plans/" + encodeURIComponent(id), adminPlanWriteResponseSchema as Parser<AdminPlanWriteResponse>, { method: "PATCH", body: JSON.stringify(input) });
}

/** Sprint 6 EP-14.US01: archive a plan (the only removal). The body carries the revision and a reason. */
export function archivePlan(id: string, input: { revision: number; reason: string }): Promise<AdminPlanWriteResponse> {
  return call("/api/subscription-plans/" + encodeURIComponent(id) + "/archive", adminPlanWriteResponseSchema as Parser<AdminPlanWriteResponse>, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** The platform settings. The answer is one document, so there is no list envelope and no id. */
export function getSettings(signal?: AbortSignal): Promise<AdminPlatformSettings> {
  return call("/api/settings", adminPlatformSettingsSchema as Parser<AdminPlatformSettings>, { signal }, (p) => (p as { settings?: unknown } | null)?.settings);
}

/** Changes the settings sent. The answer carries the new settings and the sync event queued for sellers, or null. */
export function updateSettings(input: AdminSettingsUpdateRequest): Promise<AdminSettingsUpdateResponse> {
  return call("/api/settings", adminSettingsUpdateResponseSchema as Parser<AdminSettingsUpdateResponse>, { method: "PATCH", body: JSON.stringify(input) });
}

/** The platform's headline numbers: stores, sellers, ledger totals, and outbox health, in one call. */
export function getOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return call("/api/overview", adminOverviewSchema as Parser<AdminOverview>, { signal });
}

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 4 EP-05.US03, US06: payouts and the commission report

export function listPayoutBalances(page: number, q: string, signal?: AbortSignal): Promise<PayoutBalanceList> {
  const params = new URLSearchParams({ limit: "20" });
  if (page > 1) params.set("page", String(page));
  if (q !== "") params.set("q", q);
  return call("/api/payouts/balances?" + params.toString(), payoutBalanceListSchema as Parser<PayoutBalanceList>, { signal });
}

export function listPayoutHistory(page: number, status: string, signal?: AbortSignal): Promise<PayoutList> {
  const params = new URLSearchParams({ limit: "20" });
  if (page > 1) params.set("page", String(page));
  if (status !== "") params.set("status", status);
  return call("/api/payouts?" + params.toString(), payoutListSchema as Parser<PayoutList>, { signal });
}

/** Records that a store was paid its whole balance. expectedBalance is the balance the operator saw. */
export function createPayout(input: { storeId: string; expectedBalance: number; method: string; reference: string; note: string }): Promise<PayoutRow> {
  const body = { ...input, note: input.note.trim() === "" ? null : input.note.trim(), reference: input.reference.trim() };
  return call("/api/payouts", payoutRowSchema as Parser<PayoutRow>, { method: "POST", body: JSON.stringify(body) }, (payload) => (payload as { payout?: unknown } | null)?.payout);
}

export function voidPayout(id: string, reason: string): Promise<PayoutRow> {
  return call(
    "/api/payouts/" + encodeURIComponent(id) + "/void",
    payoutRowSchema as Parser<PayoutRow>,
    { method: "POST", body: JSON.stringify({ reason }) },
    (payload) => (payload as { payout?: unknown } | null)?.payout,
  );
}

/** Finish or release a payout stuck in pending_settle. */
export function finishPayout(id: string): Promise<PayoutRow> {
  return call(
    "/api/payouts/" + encodeURIComponent(id) + "/finish",
    payoutRowSchema as Parser<PayoutRow>,
    { method: "POST" },
    (payload) => (payload as { payout?: unknown } | null)?.payout,
  );
}

/** The full payout account of a store. Audited by the backend on every call; the caller keeps it on screen only while needed. */
export function fetchPayoutDetails(storeId: string): Promise<PayoutFullDetails> {
  return call(
    "/api/payouts/details",
    payoutFullDetailsSchema as Parser<PayoutFullDetails>,
    { method: "POST", body: JSON.stringify({ storeId }) },
    (payload) => (payload as { details?: unknown } | null)?.details,
  );
}

export function getCommissionReport(input: { storeId: string; period: ReportPeriodValue; from: string; to: string }, signal?: AbortSignal): Promise<CommissionReport> {
  return call(
    "/api/commission/report?" + reportQuery(input),
    commissionReportSchema as Parser<CommissionReport>,
    { signal },
    (payload) => (payload as { report?: unknown } | null)?.report,
  );
}

/** The link of the CSV download of the same report. */
export function commissionReportCsvUrl(input: { storeId: string; period: ReportPeriodValue; from: string; to: string }): string {
  return "/api/commission/report?" + reportQuery(input, "csv");
}

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 5 EP-21.US01.T05 (D-108): review moderation


/** The answers are checked by the backends; here only that an object came back. */
const looseReviews = {
  safeParse(input: unknown): { success: true; data: ModerationReviewList } | { success: false } {
    const docs = (input as { docs?: unknown } | null)?.docs;
    return Array.isArray(docs) ? { success: true, data: input as ModerationReviewList } : { success: false };
  },
};

const looseReview = {
  safeParse(input: unknown): { success: true; data: ModerationReview } | { success: false } {
    return input !== null && typeof input === "object" && typeof (input as { reviewId?: unknown }).reviewId === "string" ? { success: true, data: input as ModerationReview } : { success: false };
  },
};

export function listModerationReviews(state: ReviewListState, signal?: AbortSignal): Promise<ModerationReviewList> {
  return call("/api/reviews?" + reviewStateToQuery(state, true), looseReviews, { signal });
}

/** Hides (with a reason) or shows again one review. */
export function runReviewAction(action: ReviewAction, reviewId: string, reason: string): Promise<ModerationReview> {
  return call("/api/reviews/" + action, looseReview, { method: "POST", body: JSON.stringify(action === "unhide" ? { reviewId } : { reviewId, reason }) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-14 (S6-B4, D-118): manual subscription payments

export function listSubscriptionPayments(state: PaymentListState, signal?: AbortSignal): Promise<AdminPaymentList> {
  return call("/api/subscription-payments?" + paymentApiQuery(state), adminPaymentListSchema as Parser<AdminPaymentList>, { signal });
}

/** Confirm (with the amount seen and a reason), reject or void (with a reason) one payment. The id is the path's. */
export function runPaymentAction(action: PaymentAction, paymentId: string, body: { amountRs?: number; reason: string }): Promise<AdminPaymentWriteResponse> {
  return call("/api/subscription-payments/" + encodeURIComponent(paymentId) + "/" + action, adminPaymentWriteResponseSchema as Parser<AdminPaymentWriteResponse>, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Sprint 6 EP-12 (S6-B5): the read-only orders view (safe fields only).
export function listOrders(state: OrderListState, signal?: AbortSignal): Promise<AdminOrderList> {
  return call("/api/orders?" + orderStateToQuery(state, true), adminOrderListSchema as Parser<AdminOrderList>, { signal });
}

export function getOrder(id: string, signal?: AbortSignal): Promise<AdminOrderDetail> {
  return call("/api/orders/" + encodeURIComponent(id), adminOrderDetailResponseSchema as Parser<{ order: AdminOrderDetail }>, { signal }, (p) => p).then((r) => r.order);
}
