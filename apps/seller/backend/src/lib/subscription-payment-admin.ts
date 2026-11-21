import type { AdminPayment, AdminPaymentList, AdminPaymentListQuery, AdminPaymentWriteResponse, InternalConfirmPaymentRequest, InternalDecidePaymentRequest } from '@markaz/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { auditBestEffort, iso, revisionFilter, revisionOf, type PaymentRow, type SubscriptionRow } from '@/lib/subscription-payments';
import { computePaymentPeriod } from '@/lib/subscription-period';
import { notifyPaymentConfirmed, notifyPaymentRejected } from '@/lib/subscription-emails';
import { Subscription, SubscriptionPayment, SubscriptionPlanModel, User, assertCan } from '@/lib/services';

/**
 * Sprint 6 EP-14 (S6-B4, D-118): the admin's side of manual subscription payments. Called only through the signed internal routes (D-093): the
 * admin console is the caller, a seller session means nothing here. Every function says so again with the policy check.
 *
 * EXACTLY ONCE. Confirming is a compare-and-set on the payment's status and revision; the winner alone writes the subscription. Two admins, a
 * double click and a retry all lose the compare-and-set with 409 and change nothing. If the subscription write then fails (somebody changed the
 * subscription in the same instant), the payment is put back to claimed and the admin is told to try again.
 */

const DECISION_FIELDS = ['status', 'decidedBy', 'decidedAt', 'reason', 'periodStart', 'periodEnd'] as const;

const SUBSCRIPTION_SNAPSHOT_FIELDS = ['planKey', 'status', 'periodStart', 'currentPeriodEnd', 'graceUntil', 'trialEndsAt', 'source', 'cancelAtPeriodEnd', 'pendingPlanKey'] as const;

/** What the subscription was, kept on the payment so a confirmed payment can be voided cleanly. */
function snapshotOf(row: SubscriptionRow): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of SUBSCRIPTION_SNAPSHOT_FIELDS) snapshot[field] = (row as unknown as Record<string, unknown>)[field] ?? null;
  return snapshot;
}

const OPEN = ['requested', 'claimed'];

interface SellerRow {
  _id: unknown;
  name?: unknown;
  email?: unknown;
}

function toAdminPayment(row: PaymentRow, seller: SellerRow | undefined, planName: string | undefined): AdminPayment {
  return {
    id: String(row._id),
    seller: { id: String(row.seller), name: typeof seller?.name === 'string' ? seller.name : '', email: typeof seller?.email === 'string' ? seller.email : '' },
    planKey: row.planKey,
    planName: planName ?? row.planKey,
    amountRs: row.amountRs,
    status: row.status as AdminPayment['status'],
    method: (row.method ?? null) as AdminPayment['method'],
    reference: row.reference ?? null,
    proofUrl: row.proofUrl ?? null,
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    reason: row.reason ?? null,
    decidedBy: row.decidedBy ?? null,
    decidedAt: iso(row.decidedAt),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    claimedAt: iso(row.claimedAt),
    revision: revisionOf(row.revision),
  };
}

/** The sellers and the plan names of some payments, in two queries. */
async function decorate(rows: readonly PaymentRow[]): Promise<AdminPayment[]> {
  if (rows.length === 0) return [];
  const sellerIds = [...new Set(rows.map((row) => String(row.seller)))];
  const keys = [...new Set(rows.map((row) => row.planKey))];
  const [sellers, plans] = await Promise.all([
    User.find({ _id: { $in: sellerIds } } as never).select('name email').lean() as unknown as Promise<SellerRow[]>,
    SubscriptionPlanModel.find({ key: { $in: keys } } as never).select('key name').lean() as unknown as Promise<Array<{ key?: string; name?: string }>>,
  ]);
  const sellerOf = new Map(sellers.map((seller) => [String(seller._id), seller]));
  const nameOf = new Map(plans.map((plan) => [String(plan.key), plan.name]));
  return rows.map((row) => toAdminPayment(row, sellerOf.get(String(row.seller)), nameOf.get(row.planKey)));
}

async function decorateOne(row: PaymentRow): Promise<AdminPayment> {
  return (await decorate([row]))[0]!;
}

async function loadPayment(paymentId: string): Promise<PaymentRow> {
  const row = (await SubscriptionPayment.findOne({ _id: paymentId } as never).lean()) as unknown as PaymentRow | null;
  if (!row) throw new HttpError(404, 'Payment not found');
  return row;
}

const rupees = (amount: number): string => 'Rs. ' + amount.toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------------------------------
// List

/** GET /api/internal/subscription-payments?status&page&limit: newest first, with the count waiting for a decision. */
export async function listPayments(query: AdminPaymentListQuery): Promise<AdminPaymentList> {
  assertCan('admin', 'read', 'subscriptionPayments');
  const filter: Record<string, unknown> = query.status ? { status: query.status } : {};
  const [rows, totalDocs, pendingCount] = await Promise.all([
    SubscriptionPayment.find(filter as never)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<PaymentRow[]>,
    SubscriptionPayment.countDocuments(filter as never),
    SubscriptionPayment.countDocuments({ status: 'claimed' } as never),
  ]);
  return {
    docs: await decorate(rows),
    page: query.page,
    limit: query.limit,
    totalDocs,
    totalPages: Math.ceil(totalDocs / query.limit),
    pendingCount,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Confirm

/** Puts a payment this call just confirmed back to claimed. Best effort: it is logged when it cannot be done. */
async function undoConfirm(decided: PaymentRow): Promise<void> {
  try {
    await SubscriptionPayment.findOneAndUpdate(
      { _id: decided._id, status: 'confirmed', revision: revisionFilter(decided.revision) } as never,
      {
        $set: { status: 'claimed', isOpen: true, decidedBy: null, decidedAt: null, reason: null, periodStart: null, periodEnd: null, subscriptionBefore: null, subscriptionRevisionAfter: null },
        $inc: { revision: 1 },
      } as never,
    )
      .select('_id')
      .lean();
  } catch (err) {
    console.error('[seller-backend] could not put a payment back after a failed confirm', err instanceof Error ? err.name : 'unknown');
  }
}

/**
 * POST /api/internal/subscription-payments/confirm { paymentId, amountRs, reason }. Only a CLAIMED payment can be confirmed, and only at the
 * amount the admin saw. Creates or extends the seller's subscription: status active, the plan of the payment, the period from
 * lib/subscription-period.ts, graceUntil cleared, a trial, a pending downgrade and a cancel flag cleared, source manual.
 */
export async function confirmPayment(input: InternalConfirmPaymentRequest, adminId: string, now: Date = new Date()): Promise<AdminPaymentWriteResponse> {
  assertCan('admin', 'update', 'subscriptionPayments', [...DECISION_FIELDS]);
  const row = await loadPayment(input.paymentId);
  if (row.status !== 'claimed') {
    throw new HttpError(
      409,
      row.status === 'confirmed' ? 'This payment was already confirmed.' : 'Only a payment the seller says they paid can be confirmed. This one is ' + row.status + '.',
      'PAYMENT_NOT_CLAIMED',
    );
  }
  if (row.amountRs !== input.amountRs) {
    throw new HttpError(409, 'This payment is for ' + rupees(row.amountRs) + ', not ' + rupees(input.amountRs) + '. Reload and check the amount.', 'PAYMENT_AMOUNT_MISMATCH');
  }
  const plan = (await SubscriptionPlanModel.findOne({ key: row.planKey } as never).select('key name').lean()) as { key?: string } | null;
  if (!plan) throw new HttpError(409, 'The plan of this payment no longer exists. Reject the payment and ask the seller to choose a plan again.', 'PLAN_GONE');

  const current = (await Subscription.findOne({ seller: row.seller } as never).lean()) as unknown as SubscriptionRow | null;
  const period = computePaymentPeriod({ now, planKey: row.planKey, current });

  // The winner of this compare-and-set is the only one that goes on.
  const decided = (await SubscriptionPayment.findOneAndUpdate(
    { _id: row._id, status: 'claimed', revision: revisionFilter(row.revision) } as never,
    {
      $set: {
        status: 'confirmed',
        isOpen: false,
        decidedBy: 'admin:' + adminId,
        decidedAt: now,
        reason: input.reason,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        subscriptionBefore: current ? snapshotOf(current) : null,
        subscriptionRevisionAfter: revisionOf(current?.revision) + 1,
      },
      $inc: { revision: 1 },
    } as never,
    { new: true },
  ).lean()) as unknown as PaymentRow | null;
  if (!decided) throw new HttpError(409, 'Someone else already decided this payment. Reload the list.', 'PAYMENT_ALREADY_DECIDED');

  const paid = {
    planKey: row.planKey,
    status: 'active',
    periodStart: period.periodStart,
    currentPeriodEnd: period.periodEnd,
    graceUntil: null,
    trialEndsAt: null,
    source: 'manual',
    cancelAtPeriodEnd: false,
    pendingPlanKey: null,
  };
  try {
    if (current) {
      const moved = await Subscription.findOneAndUpdate({ _id: current._id, revision: revisionFilter(current.revision) } as never, { $set: paid, $inc: { revision: 1 } } as never, { new: true })
        .select('_id')
        .lean();
      if (!moved) throw new HttpError(409, 'The subscription changed while the payment was being confirmed. Nothing was changed. Try again.', 'SUBSCRIPTION_CHANGED');
    } else {
      await Subscription.create({ seller: row.seller, ...paid, revision: 1 } as never);
    }
  } catch (err) {
    await undoConfirm(decided);
    if (err instanceof HttpError) throw err;
    if (isDuplicateKeyError(err)) throw new HttpError(409, 'The subscription changed while the payment was being confirmed. Nothing was changed. Try again.', 'SUBSCRIPTION_CHANGED');
    throw err;
  }

  await auditBestEffort('subscription_payment.confirm', String(decided._id), 'admin:' + adminId, {
    seller: String(row.seller),
    planKey: row.planKey,
    amountRs: decided.amountRs,
    method: decided.method ?? null,
    reference: decided.reference ?? null,
    reason: input.reason,
    periodStart: period.periodStart.toISOString(),
    periodEnd: period.periodEnd.toISOString(),
    extended: period.extended,
  });
  notifyPaymentConfirmed({ id: String(decided._id), seller: String(row.seller), planKey: row.planKey, amountRs: decided.amountRs, periodEnd: period.periodEnd });
  return { payment: await decorateOne(decided) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reject and void

/** POST /api/internal/subscription-payments/reject { paymentId, reason }: a requested or claimed payment is refused. Nothing else changes. */
export async function rejectPayment(input: InternalDecidePaymentRequest, adminId: string, now: Date = new Date()): Promise<AdminPaymentWriteResponse> {
  assertCan('admin', 'update', 'subscriptionPayments', [...DECISION_FIELDS]);
  const row = await loadPayment(input.paymentId);
  if (!OPEN.includes(row.status)) throw new HttpError(409, 'Only a payment that is still waiting can be rejected. This one is ' + row.status + '.', 'PAYMENT_NOT_OPEN');
  const decided = (await SubscriptionPayment.findOneAndUpdate(
    { _id: row._id, status: row.status, revision: revisionFilter(row.revision) } as never,
    { $set: { status: 'rejected', isOpen: false, decidedBy: 'admin:' + adminId, decidedAt: now, reason: input.reason }, $inc: { revision: 1 } } as never,
    { new: true },
  ).lean()) as unknown as PaymentRow | null;
  if (!decided) throw new HttpError(409, 'Someone else already decided this payment. Reload the list.', 'PAYMENT_ALREADY_DECIDED');

  await auditBestEffort('subscription_payment.reject', String(decided._id), 'admin:' + adminId, {
    seller: String(row.seller),
    planKey: row.planKey,
    amountRs: decided.amountRs,
    from: row.status,
    reason: input.reason,
  });
  notifyPaymentRejected({ id: String(decided._id), seller: String(row.seller), planKey: row.planKey, amountRs: decided.amountRs, reason: input.reason }, 'rejected');
  return { payment: await decorateOne(decided) };
}

/**
 * POST /api/internal/subscription-payments/void { paymentId, reason }.
 *   requested or claimed   closed as void (nothing was bought)
 *   confirmed              taken back: the subscription goes back to what it was before this payment, but ONLY while nothing else has changed it
 *                          since (its revision is still the one this payment wrote); otherwise 409 and nothing changes
 *   rejected, void         409
 *
 * TODO(S6-B6): once the admin levels exist, voiding a CONFIRMED payment is for the owner level only (a capability named for it in the admin
 * capability guard). Until then any admin may, and the audit line names who.
 */
export async function voidPayment(input: InternalDecidePaymentRequest, adminId: string, now: Date = new Date()): Promise<AdminPaymentWriteResponse> {
  assertCan('admin', 'update', 'subscriptionPayments', [...DECISION_FIELDS]);
  const row = await loadPayment(input.paymentId);
  const wasConfirmed = row.status === 'confirmed';
  if (!wasConfirmed && !OPEN.includes(row.status)) throw new HttpError(409, 'This payment is ' + row.status + ' and cannot be voided.', 'PAYMENT_NOT_VOIDABLE');

  let sub: SubscriptionRow | null = null;
  if (wasConfirmed) {
    sub = (await Subscription.findOne({ seller: row.seller } as never).lean()) as unknown as SubscriptionRow | null;
    if (!sub || revisionOf(sub.revision) !== revisionOf(row.subscriptionRevisionAfter)) {
      throw new HttpError(409, 'The subscription has changed since this payment was confirmed, so it cannot be taken back here. Nothing was changed.', 'SUBSCRIPTION_CHANGED');
    }
  }

  const decided = (await SubscriptionPayment.findOneAndUpdate(
    { _id: row._id, status: row.status, revision: revisionFilter(row.revision) } as never,
    { $set: { status: 'void', isOpen: false, decidedBy: 'admin:' + adminId, decidedAt: now, reason: input.reason }, $inc: { revision: 1 } } as never,
    { new: true },
  ).lean()) as unknown as PaymentRow | null;
  if (!decided) throw new HttpError(409, 'Someone else already decided this payment. Reload the list.', 'PAYMENT_ALREADY_DECIDED');

  if (wasConfirmed && sub) {
    const before = row.subscriptionBefore;
    const restore: Record<string, unknown> = before ? { ...before } : { status: 'expired', graceUntil: null, pendingPlanKey: null };
    try {
      const moved = await Subscription.findOneAndUpdate({ _id: sub._id, revision: revisionFilter(sub.revision) } as never, { $set: restore, $inc: { revision: 1 } } as never, { new: true })
        .select('_id')
        .lean();
      if (!moved) throw new HttpError(409, 'The subscription changed while the payment was being voided. Nothing was changed. Try again.', 'SUBSCRIPTION_CHANGED');
    } catch (err) {
      try {
        await SubscriptionPayment.findOneAndUpdate(
          { _id: decided._id, status: 'void', revision: revisionFilter(decided.revision) } as never,
          { $set: { status: 'confirmed', decidedBy: row.decidedBy ?? null, decidedAt: row.decidedAt ?? null, reason: row.reason ?? null }, $inc: { revision: 1 } } as never,
        )
          .select('_id')
          .lean();
      } catch (undoErr) {
        console.error('[seller-backend] could not put a payment back after a failed void', undoErr instanceof Error ? undoErr.name : 'unknown');
      }
      throw err;
    }
  }

  await auditBestEffort('subscription_payment.void', String(decided._id), 'admin:' + adminId, {
    seller: String(row.seller),
    planKey: row.planKey,
    amountRs: decided.amountRs,
    from: row.status,
    reason: input.reason,
    subscriptionRestored: wasConfirmed,
  });
  notifyPaymentRejected({ id: String(decided._id), seller: String(row.seller), planKey: row.planKey, amountRs: decided.amountRs, reason: input.reason }, 'voided');
  return { payment: await decorateOne(decided) };
}
