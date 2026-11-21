import type { AuthRateRule } from '@markaz/auth';
import type { OwnPayment, OwnSubscription, OwnSubscriptionResponse, PaymentInstructions } from '@markaz/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { loadEffectivePlan, FREE_PLAN_KEY } from '@/lib/plan';
import { readPlanSettings } from '@/lib/platform-settings';
import { notifyPaymentClaimed } from '@/lib/subscription-emails';
import { Subscription, SubscriptionPayment, SubscriptionPlanModel, writeAuditLog } from '@/lib/services';

/**
 * Sprint 6 EP-14 (S6-B4, D-118): a seller's side of manual subscription payments. The seller asks to upgrade (the server writes the amount: the
 * plan's price, never the body), pays by bank, JazzCash or Easypaisa outside the platform, and says "I paid"; an admin checks the money and
 * confirms it (lib/subscription-payment-admin.ts).
 *
 * Every function takes the seller's id from the session and scopes every read and write by it: another seller's payment is a 404, never a 403.
 * Every move is ONE compare-and-set on the status and the revision that were read. At most one payment per seller is open (requested or claimed):
 * the unique partial index on {seller, isOpen: true} decides a race, and a duplicate-key error here is the same 409 as the plain check.
 */

const HOUR_MS = 60 * 60 * 1000;
/** The Mongo-backed limiter (D-081), per signed-in seller: asking, saying "I paid", and changing the plan each get their own hourly allowance. */
export const PAYMENT_REQUEST_RULE: AuthRateRule = { name: 'subscription-payment-request', limit: 10, windowMs: HOUR_MS };
export const PAYMENT_CLAIM_RULE: AuthRateRule = { name: 'subscription-payment-claim', limit: 10, windowMs: HOUR_MS };
export const SUBSCRIPTION_CHANGE_RULE: AuthRateRule = { name: 'subscription-change', limit: 20, windowMs: HOUR_MS };

export const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/** The compare-and-set revision of a read row: a row that never had one matches 0 or null. */
export function revisionFilter(revision: unknown): number | { $in: Array<number | null> } {
  const n = typeof revision === 'number' ? revision : 0;
  return n === 0 ? { $in: [0, null] } : n;
}

export const revisionOf = (revision: unknown): number => (typeof revision === 'number' ? revision : 0);

/** Best effort: a failed audit line never undoes a payment decision. */
export async function auditBestEffort(action: string, entityId: string, actorId: string, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'subscriptionPayment', entityId, actorId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the subscription payment audit entry', err instanceof Error ? err.name : 'unknown');
  }
}

export interface PaymentRow {
  _id: unknown;
  seller: unknown;
  planKey: string;
  amountRs: number;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  method?: string | null;
  reference?: string | null;
  proofUrl?: string | null;
  status: string;
  isOpen?: boolean | null;
  decidedBy?: string | null;
  decidedAt?: Date | string | null;
  reason?: string | null;
  claimedAt?: Date | string | null;
  subscriptionBefore?: Record<string, unknown> | null;
  subscriptionRevisionAfter?: number | null;
  revision?: number | null;
  createdAt?: Date | string | null;
}

/** What the seller reads of their own payment: no seller id, no admin, no revision. */
export function toOwnPayment(row: PaymentRow): OwnPayment {
  return {
    id: String(row._id),
    planKey: row.planKey,
    amountRs: row.amountRs,
    status: row.status as OwnPayment['status'],
    method: (row.method ?? null) as OwnPayment['method'],
    reference: row.reference ?? null,
    proofUrl: row.proofUrl ?? null,
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    reason: row.reason ?? null,
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    claimedAt: iso(row.claimedAt),
    decidedAt: iso(row.decidedAt),
  };
}

export interface SubscriptionRow {
  _id: unknown;
  seller?: unknown;
  planKey: string;
  status: string;
  periodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  graceUntil?: Date | string | null;
  trialEndsAt?: Date | string | null;
  source?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  pendingPlanKey?: string | null;
  revision?: number | null;
}

export function toOwnSubscription(row: SubscriptionRow | null): OwnSubscription | null {
  if (!row) return null;
  return {
    planKey: row.planKey,
    status: row.status as OwnSubscription['status'],
    periodStart: iso(row.periodStart),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    graceUntil: iso(row.graceUntil),
    trialEndsAt: iso(row.trialEndsAt),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    pendingPlanKey: row.pendingPlanKey ?? null,
    source: row.source === 'stripe' ? 'stripe' : 'manual',
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads

/** GET /api/subscription: the seller's subscription, the open payment and the last 20 payments. */
export async function readOwnSubscription(sellerId: string): Promise<OwnSubscriptionResponse> {
  const [subscription, open, payments] = await Promise.all([
    Subscription.findOne({ seller: sellerId } as never).lean() as unknown as Promise<SubscriptionRow | null>,
    SubscriptionPayment.findOne({ seller: sellerId, isOpen: true } as never).lean() as unknown as Promise<PaymentRow | null>,
    SubscriptionPayment.find({ seller: sellerId } as never)
      .sort({ createdAt: -1, _id: -1 })
      .limit(20)
      .lean() as unknown as Promise<PaymentRow[]>,
  ]);
  return { subscription: toOwnSubscription(subscription), open: open ? toOwnPayment(open) : null, payments: payments.map(toOwnPayment) };
}

/** GET /api/subscription/instructions: the admin's plain text and the support contacts. Whoever renders the text escapes it. */
export async function readPaymentInstructions(): Promise<PaymentInstructions> {
  const settings = await readPlanSettings();
  return { paymentInstructions: settings.paymentInstructions, supportEmail: settings.supportEmail, supportPhone: settings.supportPhone };
}

// ---------------------------------------------------------------------------------------------------------------------
// Upgrade request

const openPaymentExists = (): HttpError =>
  new HttpError(409, 'You already have a payment waiting for a decision. Wait for it to be checked, or contact support.', 'PAYMENT_OPEN');

interface PlanPriceRow {
  key?: string;
  name?: string;
  priceRs?: unknown;
  isActive?: boolean | null;
  archivedAt?: Date | string | null;
}

/**
 * POST /api/subscription/payments { planKey }: asks to upgrade (or renew). The amount is the plan's price (whole rupees), read here. A free plan
 * cannot be requested. A cheaper plan than the one in force goes through the downgrade route. One open payment per seller: an unclaimed request
 * for the same plan is returned as it is (a double click), an unclaimed request for another plan is replaced, a claimed one blocks (409).
 */
export async function requestUpgrade(sellerId: string, planKey: string, now: Date = new Date()): Promise<{ payment: OwnPayment; created: boolean }> {
  const plan = (await SubscriptionPlanModel.findOne({ key: planKey } as never).select('key name priceRs isActive archivedAt').lean()) as unknown as PlanPriceRow | null;
  if (!plan || plan.isActive === false || plan.archivedAt) throw new HttpError(404, 'That plan is not available.', 'PLAN_NOT_FOUND', 'planKey');
  const price = plan.priceRs;
  if (typeof price !== 'number' || !Number.isInteger(price) || price <= 0) {
    throw new HttpError(422, 'The ' + (plan.name ?? planKey) + ' plan is free: there is nothing to pay.', 'PLAN_IS_FREE', 'planKey');
  }

  const effective = await loadEffectivePlan(sellerId, now);
  if (effective.key !== FREE_PLAN_KEY && effective.key !== planKey) {
    const current = (await SubscriptionPlanModel.findOne({ key: effective.key } as never).select('key priceRs').lean()) as unknown as PlanPriceRow | null;
    if (typeof current?.priceRs === 'number' && current.priceRs > price) {
      throw new HttpError(422, 'To move to a cheaper plan use Downgrade: it starts when your current period ends.', 'USE_DOWNGRADE', 'planKey');
    }
  }

  const open = (await SubscriptionPayment.findOne({ seller: sellerId, isOpen: true } as never).lean()) as unknown as PaymentRow | null;
  if (open) {
    if (open.status !== 'requested') throw openPaymentExists();
    if (open.planKey === planKey && open.amountRs === price) return { payment: toOwnPayment(open), created: false };
    // An unclaimed request for another plan (or at an old price) is taken back before the new one is written.
    const replaced = await SubscriptionPayment.findOneAndUpdate(
      { _id: open._id, seller: sellerId, status: 'requested', revision: revisionFilter(open.revision) } as never,
      { $set: { status: 'void', isOpen: false, decidedBy: 'seller:' + sellerId, decidedAt: now, reason: 'Replaced by a new request' }, $inc: { revision: 1 } } as never,
      { new: true },
    )
      .select('_id')
      .lean();
    if (!replaced) throw openPaymentExists();
  }

  let created: PaymentRow;
  try {
    created = (await SubscriptionPayment.create({ seller: sellerId, planKey, amountRs: price } as never)) as unknown as PaymentRow;
  } catch (err) {
    if (isDuplicateKeyError(err)) throw openPaymentExists();
    throw err;
  }
  await auditBestEffort('subscription_payment.request', String(created._id), 'seller:' + sellerId, { seller: sellerId, planKey, amountRs: price });
  return { payment: toOwnPayment(created), created: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// I paid

export interface ClaimInput {
  paymentId: string;
  method: string;
  reference: string;
  proofUrl?: string | null;
}

/** POST /api/subscription/payments/claim: requested -> claimed with the method, the reference and the optional proof link. Own payment only. */
export async function claimPayment(sellerId: string, input: ClaimInput, now: Date = new Date()): Promise<OwnPayment> {
  const row = (await SubscriptionPayment.findOne({ _id: input.paymentId, seller: sellerId } as never).lean()) as unknown as PaymentRow | null;
  if (!row) throw new HttpError(404, 'Payment not found');
  if (row.status !== 'requested') {
    throw new HttpError(409, row.status === 'claimed' ? 'You already said you paid. It is waiting to be checked.' : 'This payment can no longer be changed.', 'PAYMENT_NOT_REQUESTED');
  }
  const updated = (await SubscriptionPayment.findOneAndUpdate(
    { _id: row._id, seller: sellerId, status: 'requested', revision: revisionFilter(row.revision) } as never,
    { $set: { status: 'claimed', method: input.method, reference: input.reference, proofUrl: input.proofUrl ?? null, claimedAt: now }, $inc: { revision: 1 } } as never,
    { new: true },
  ).lean()) as unknown as PaymentRow | null;
  if (!updated) throw new HttpError(409, 'This payment was changed in the meantime. Reload and check.', 'PAYMENT_NOT_REQUESTED');

  await auditBestEffort('subscription_payment.claim', String(updated._id), 'seller:' + sellerId, {
    seller: sellerId,
    planKey: updated.planKey,
    amountRs: updated.amountRs,
    method: updated.method ?? null,
    reference: updated.reference ?? null,
  });
  notifyPaymentClaimed({
    id: String(updated._id),
    seller: sellerId,
    planKey: updated.planKey,
    amountRs: updated.amountRs,
    method: updated.method ?? null,
    reference: updated.reference ?? null,
  });
  return toOwnPayment(updated);
}
