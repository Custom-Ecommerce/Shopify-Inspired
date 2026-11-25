import * as signatureNs from '@markaz/platform-kit/internal-signature';
import { AdminHttpError } from '@/lib/admin-auth';
import { unwrapCjs } from '@/lib/cjs';
// Type-only and erased at build: this app has no dependency on @markaz/contracts yet. The seller backend and the admin
// console validate against the runtime schemas of this file.
import type {
  CommissionReport,
  CreatePayoutRequest,
  PayoutBalanceList,
  PayoutFullDetails,
  PayoutList,
  PayoutRow,
} from '../../../../../packages/contracts/src/payouts';
import type {
  ModerationPermanentDeleteResponse,
  ModerationProduct,
  ModerationProductList,
} from '../../../../../packages/contracts/src/moderation';

import type { ModerationReview, ModerationReviewList } from '../../../../../packages/contracts/src/review';
import type { AdminSellerPlansResponse } from '../../../../../packages/contracts/src/subscription';
import type { AdminPaymentList, AdminPaymentWriteResponse } from '../../../../../packages/contracts/src/subscription-payments';
import type { AdminOrderList, AdminOrderDetail } from '../../../../../packages/contracts/src/admin-orders';
import type { AdminKpi } from '../../../../../packages/contracts/src/admin-overview';
import type { RetentionRunResponse } from '../../../../../packages/contracts/src/admin-retries';
import type { AdminReferralExport, AdminReferralList } from '../../../../../packages/contracts/src/admin-referrals';

const { INTERNAL_SECRET_MIN_LENGTH, internalRequestHeaders } = unwrapCjs(signatureNs) as typeof signatureNs;

const TIMEOUT_MS = 8000;
const BASE_PATH = '/api/internal/moderation';

function configuration(label: string): { baseUrl: string; secret: string } {
  // SELLER_BACKEND_API_URL is the name this app's environment already uses for the same address.
  const baseUrl = (process.env.SELLER_BACKEND_URL ?? process.env.SELLER_BACKEND_API_URL ?? '').trim().replace(/\/+$/, '');
  const secret = process.env.MODERATION_API_SECRET ?? '';
  if (baseUrl === '' || secret.length < INTERNAL_SECRET_MIN_LENGTH) throw new AdminHttpError(503, label + ' is not configured');
  return { baseUrl, secret };
}

/** The seller backend's own words for a refusal, so the operator sees why. */
function refusalMessage(payload: unknown): string {
  const errors = (payload as { errors?: Array<{ message?: unknown }> } | null)?.errors;
  const message = errors?.[0]?.message;
  return typeof message === 'string' ? message : 'The seller backend refused the request';
}

/**
 * One signed call. Its 401 means this console's signature was refused, a setup problem: it must not read as the operator's
 * own session ending, so it answers 503. A refusal the operator can act on keeps its status and message.
 */
async function send<T>(method: 'GET' | 'POST', path: string, adminId: string, input?: unknown, label: string = 'Product moderation'): Promise<T> {
  const { baseUrl, secret } = configuration(label);
  const body = input === undefined ? '' : JSON.stringify(input);
  const signed = internalRequestHeaders(secret, { method, path, adminId, body });

  let response: Response;
  try {
    response = await fetch(baseUrl + path, {
      method,
      headers: { accept: 'application/json', ...signed, ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(input === undefined ? {} : { body }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AdminHttpError(503, 'The seller backend did not answer');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) {
    if (payload === null) throw new AdminHttpError(502, 'Unexpected response from the seller backend');
    return payload as T;
  }
  if (response.status === 401 || response.status === 503) throw new AdminHttpError(503, label + ' is unavailable');
  if ([403, 404, 409, 422].includes(response.status)) {
    // The seller backend's own code (PAYOUT_BALANCE_CHANGED, EMAIL_NOT_VERIFIED, ...) travels with the message.
    const code = (payload as { code?: unknown } | null)?.code;
    throw new AdminHttpError(response.status, refusalMessage(payload), typeof code === 'string' ? code : undefined);
  }
  throw new AdminHttpError(502, 'The seller backend could not complete the request');
}

export type ModerationListFilters = Record<'page' | 'limit' | 'storeId' | 'status' | 'q', string | undefined>;

export function listModerationProducts(adminId: string, filters: Partial<ModerationListFilters>): Promise<ModerationProductList> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(name, value);
  }
  const query = params.toString();
  return send('GET', BASE_PATH + '/products' + (query === '' ? '' : '?' + query), adminId);
}

export const takedownProduct = (adminId: string, productId: string, reason: string): Promise<ModerationProduct> =>
  send('POST', BASE_PATH + '/takedown', adminId, { productId, reason });

export const restoreProduct = (adminId: string, productId: string): Promise<ModerationProduct> =>
  send('POST', BASE_PATH + '/restore', adminId, { productId });

export const deleteProduct = (adminId: string, productId: string, reason: string): Promise<ModerationProduct> =>
  send('POST', BASE_PATH + '/delete', adminId, { productId, reason });

export const permanentlyDeleteProduct = (adminId: string, productId: string, reason: string): Promise<ModerationPermanentDeleteResponse> =>
  send('POST', BASE_PATH + '/permanent-delete', adminId, { productId, reason });

/**
 * Sprint 4 EP-08.US03.T02: applies a seller account status in the seller database, where every seller request is
 * checked (POST /api/internal/accounts/status, signed like moderation).
 */
export const setSellerAccountStatus = (
  adminId: string,
  input: { userId: string; status: 'active' | 'suspended'; reason: string | null },
): Promise<{ userId: string; status: string; changed: boolean }> => send('POST', '/api/internal/accounts/status', adminId, input, 'Seller account control');

/**
 * Sprint 6 EP-12.US02.T02 (D-118): applies a seller's store-limit override in the seller database, where provisionStore reads it
 * (POST /api/internal/accounts/store-limit, signed like the account status call). null clears the override.
 */
export const setSellerStoreLimit = (
  adminId: string,
  input: { userId: string; storeLimitOverride: number | null },
): Promise<{ userId: string; storeLimitOverride: number | null; changed: boolean }> =>
  send('POST', '/api/internal/accounts/store-limit', adminId, input, 'Seller store limit');

/**
 * Sprint 6 EP-14.US02.T08 (D-118): the plan, status and usage of up to 100 sellers, read in the seller database (POST
 * /api/internal/plans/sellers, signed like the store-limit call). Read only.
 */
export const readSellerPlans = (adminId: string, input: { sellerIds: string[] }): Promise<AdminSellerPlansResponse> =>
  send('POST', '/api/internal/plans/sellers', adminId, input, 'Seller plans');

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 4 EP-05.US03, US06 (D-090): payouts and the commission report. The ledger and the payouts live in the seller
// database, so each of these is one signed call to the seller backend (the same signature as moderation).

const PAYOUT_LABEL = 'Payouts';
const query = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(name, String(value));
  const text = search.toString();
  return text === '' ? '' : '?' + text;
};

export const listPayoutBalances = (adminId: string, params: { page?: number; limit?: number; q?: string }): Promise<PayoutBalanceList> =>
  send('GET', '/api/internal/payouts/balances' + query(params), adminId, undefined, PAYOUT_LABEL);

export const listPayoutHistory = (adminId: string, params: { page?: number; limit?: number; storeId?: string; status?: string }): Promise<PayoutList> =>
  send('GET', '/api/internal/payouts' + query(params), adminId, undefined, PAYOUT_LABEL);

export const createPayout = (adminId: string, input: CreatePayoutRequest): Promise<PayoutRow> => send('POST', '/api/internal/payouts', adminId, input, PAYOUT_LABEL);

export const voidPayout = (adminId: string, input: { payoutId: string; reason: string }): Promise<PayoutRow> =>
  send('POST', '/api/internal/payouts/void', adminId, input, PAYOUT_LABEL);

export const finishPayout = (adminId: string, input: { payoutId: string }): Promise<PayoutRow> =>
  send('POST', '/api/internal/payouts/finish', adminId, input, PAYOUT_LABEL);

/** The full payout account of one store. The seller backend audits every call; this one only forwards it. */
export const readPayoutDetails = (adminId: string, input: { storeId: string }): Promise<PayoutFullDetails> =>
  send('POST', '/api/internal/payouts/details', adminId, input, PAYOUT_LABEL);

export const readCommissionReport = (adminId: string, params: { storeId: string; period: string; from?: string; to?: string }): Promise<CommissionReport> =>
  send('GET', '/api/internal/commission/report' + query(params), adminId, undefined, 'Commission report');

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 5 EP-21.US01.T05 (D-108): review moderation. The reviews live in the seller database and only the seller backend can purge the
// storefront's cache, so hiding and showing a review are signed calls to it, like the product moderation above.

const REVIEW_LABEL = 'Review moderation';

export type ReviewListFilters = Record<'page' | 'limit' | 'storeId' | 'status', string | undefined>;

export function listModerationReviews(adminId: string, filters: Partial<ReviewListFilters>): Promise<ModerationReviewList> {
  return send('GET', BASE_PATH + '/reviews' + query(filters), adminId, undefined, REVIEW_LABEL);
}

export const hideReview = (adminId: string, reviewId: string, reason: string): Promise<ModerationReview> =>
  send('POST', BASE_PATH + '/reviews/hide', adminId, { reviewId, reason }, REVIEW_LABEL);

export const unhideReview = (adminId: string, reviewId: string): Promise<ModerationReview> =>
  send('POST', BASE_PATH + '/reviews/unhide', adminId, { reviewId }, REVIEW_LABEL);

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-14 (S6-B4, D-118, D-093): manual subscription payments. The payments and the subscriptions live in the seller database, so each of
// these is one signed call to the seller backend (the same signature as moderation). Only that call decides: the console never writes a payment.

const SUBSCRIPTION_PAYMENT_LABEL = 'Subscription payments';

export const listSubscriptionPayments = (adminId: string, params: { status?: string; page?: number; limit?: number }): Promise<AdminPaymentList> =>
  send('GET', '/api/internal/subscription-payments' + query(params), adminId, undefined, SUBSCRIPTION_PAYMENT_LABEL);

export const confirmSubscriptionPayment = (adminId: string, input: { paymentId: string; amountRs: number; reason: string }): Promise<AdminPaymentWriteResponse> =>
  send('POST', '/api/internal/subscription-payments/confirm', adminId, input, SUBSCRIPTION_PAYMENT_LABEL);

export const rejectSubscriptionPayment = (adminId: string, input: { paymentId: string; reason: string }): Promise<AdminPaymentWriteResponse> =>
  send('POST', '/api/internal/subscription-payments/reject', adminId, input, SUBSCRIPTION_PAYMENT_LABEL);

export const voidSubscriptionPayment = (adminId: string, input: { paymentId: string; reason: string }): Promise<AdminPaymentWriteResponse> =>
  send('POST', '/api/internal/subscription-payments/void', adminId, input, SUBSCRIPTION_PAYMENT_LABEL);

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 (S6-B5, D-093, D-095): the read-only orders view and the overview KPIs. Signed calls to the seller backend, which returns SAFE fields
// only (no name, phone, address or email) and computes the KPIs from the NEW commission ledger.

export const listAdminOrders = (adminId: string, input: Record<string, unknown>): Promise<AdminOrderList> =>
  send('POST', '/api/internal/orders', adminId, input, 'Orders');

export const readAdminOrderDetail = (adminId: string, input: { orderId: string }): Promise<{ order: AdminOrderDetail }> =>
  send('POST', '/api/internal/orders/detail', adminId, input, 'Orders');

export const readKpi = (adminId: string): Promise<AdminKpi> => send('POST', '/api/internal/kpi', adminId, {}, 'Overview KPIs');

/** Sprint 6 (S6-B7): the retention run, a signed call to the seller backend. A dry run (the default) only counts; apply purges, capped per target. */
export const runRetention = (adminId: string, input: { apply?: boolean }): Promise<RetentionRunResponse> => send('POST', '/api/internal/retention/admin', adminId, input, 'Retention');

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 7 (S7-B4): support tickets and the platform contact messages. They live in the seller database, so each is one signed call (the same signature
// as moderation). The seller backend answers with the sellers names and the messages as plain text; the console shows them as text.

const SUPPORT_LABEL = 'Support';
export type SupportListFilters = { status?: string | undefined; page?: number | undefined; limit?: number | undefined };
const clean = (filters: SupportListFilters): Record<string, unknown> => Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''));

export const listSupportTickets = (adminId: string, filters: SupportListFilters): Promise<Record<string, unknown>> =>
  send('POST', '/api/internal/support/tickets/list', adminId, clean(filters), SUPPORT_LABEL);
export const readSupportTicket = (adminId: string, id: string): Promise<Record<string, unknown>> => send('POST', '/api/internal/support/tickets/detail', adminId, { id }, SUPPORT_LABEL);
export const replySupportTicket = (adminId: string, input: { id: string; revision: number; text: string }): Promise<Record<string, unknown>> =>
  send('POST', '/api/internal/support/tickets/reply', adminId, input, SUPPORT_LABEL);
export const setSupportTicketStatus = (adminId: string, input: { id: string; revision: number; status: string }): Promise<Record<string, unknown>> =>
  send('POST', '/api/internal/support/tickets/status', adminId, input, SUPPORT_LABEL);
export const listPlatformContact = (adminId: string, filters: SupportListFilters): Promise<Record<string, unknown>> =>
  send('POST', '/api/internal/support/contact/list', adminId, clean(filters), SUPPORT_LABEL);
export const readPlatformContact = (adminId: string, id: string): Promise<Record<string, unknown>> => send('POST', '/api/internal/support/contact/detail', adminId, { id }, SUPPORT_LABEL);

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 8 (S8-B6): referrals, read only. The rows live in the seller database; the seller backend masks the referred seller.

export const listReferrals = (adminId: string, input: Record<string, unknown>): Promise<AdminReferralList> => send('POST', '/api/internal/referrals', adminId, input, 'Referrals');

export const exportReferralRewards = (adminId: string, input: Record<string, unknown>): Promise<AdminReferralExport> => send('POST', '/api/internal/referrals/export', adminId, input, 'Referrals');
