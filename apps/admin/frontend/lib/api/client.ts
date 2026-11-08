import {
  adminStoreDetailSchema,
  adminStoreListEnvelopeSchema,
  storeStatusChangeResponseSchema,
  type AdminStoreDetail,
  type AdminStoreListEnvelope,
  type StoreStatusChangeRequest,
  type StoreStatusChangeResponse,
  adminSellerListEnvelopeSchema,
  adminSyncOutboxSchema,
  adminAuditListSchema,
  type AdminSellerListEnvelope,
  type AdminSyncOutbox,
  type AdminAuditList,
  adminLedgerListSchema,
  adminCommissionRatesSchema,
  adminSubscriptionPlanListSchema,
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
import { adminOverviewSchema, type AdminOverview } from "@/lib/contracts";
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

export function listSubscriptionPlans(state: SubscriptionListState, signal?: AbortSignal): Promise<AdminSubscriptionPlanList> {
  return call("/api/subscription-plans?" + subscriptionStateToQuery(state, true), adminSubscriptionPlanListSchema as Parser<AdminSubscriptionPlanList>, { signal });
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
