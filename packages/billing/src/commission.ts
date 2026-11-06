
import type { Types } from 'mongoose';
import { CommissionLedgerModel } from '@markaz/db-schemas';
import { isDuplicateKeyError } from './util';

/** Store fields the rate resolution reads. */
export interface CommissionStoreFields {
  commissionMode?: 'inherit' | 'custom' | null;
  commissionRate?: number | null;
}

export interface CommissionInput {
  /** Ledger orderId. In Payload this is the checkout metadata orderRef. */
  orderId: string;
  /** Seller-side order document id. In Payload this is the checkout metadata orderId. */
  sellerOrderDocId: string;
  store: Types.ObjectId;
  /** Minor units, as the Payload Connect webhook stores them. */
  orderAmount: number;
  /** Percentage, 0 to 100. */
  commissionRate: number;
  paymentMethod: 'card' | 'cod';
  stripePaymentIntentId?: string;
  applicationFeeId?: string;
}

export interface RecordCommissionResult {
  created: boolean;
}

const isRate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Payload's effective-rate rule (apps/admin/src/lib/effective-commission.ts): an inherit store
 * uses the platform default; a custom store, or one with no mode, uses its own rate. If the rate
 * that applies is unusable, the result is null and the caller decides what to do.
 */
export function resolveEffectiveCommissionRate(
  store: CommissionStoreFields | null | undefined,
  defaultRate?: number | null,
): number | null {
  if (!store) return null;
  if (store.commissionMode === 'inherit' && isRate(defaultRate)) return defaultRate;
  return isRate(store.commissionRate) ? store.commissionRate : null;
}

/** Payload's formula (handle-checkout-completed.ts): Math.round((orderAmount * rate) / 100). Integer minor units. */
export function computeCommission(orderAmount: number, commissionRate: number): number {
  if (!Number.isFinite(orderAmount) || orderAmount < 0) {
    throw new RangeError('orderAmount must be a non-negative finite number');
  }
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
    throw new RangeError('commissionRate must be a percentage between 0 and 100');
  }
  return Math.round((orderAmount * commissionRate) / 100);
}

/** Idempotent on orderId: a replay or duplicate webhook creates no second row (H-D). */
export async function recordCommissionOnce(input: CommissionInput): Promise<RecordCommissionResult> {
  const commissionAmount = computeCommission(input.orderAmount, input.commissionRate);
  try {
    const result = await CommissionLedgerModel.updateOne(
      { orderId: input.orderId },
      {
        $setOnInsert: {
          orderId: input.orderId,
          sellerOrderDocId: input.sellerOrderDocId,
          store: input.store,
          orderAmount: input.orderAmount,
          commissionRate: input.commissionRate,
          commissionAmount,
          status: 'pending',
          paymentMethod: input.paymentMethod,
          stripePaymentIntentId: input.stripePaymentIntentId ?? '',
          applicationFeeId: input.applicationFeeId ?? '',
        },
      },
      { upsert: true },
    );
    return { created: result.upsertedCount === 1 };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return { created: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Refund reversals. Amounts are integer minor units (D-U). Reversal rows are
// negative. Uniqueness is enforced by (orderId, status, refundId) in the ledger
// schema, so each Stripe refund writes at most one reversal row.
// ---------------------------------------------------------------------------

export interface LedgerWriterPort {
  create(doc: Record<string, unknown>): Promise<unknown>;
}

export interface RefundReversalInput {
  store: string;
  orderId: string;
  refundId: string;
  sellerOrderDocId: string | null;
  refundAmountMinor: number;
  commissionRate: number;
  paymentMethod: string | null;
  stripePaymentIntentId: string;
  settlementDate?: Date;
}

export interface RefundReversalResult {
  recorded: boolean;
  orderAmount: number;
  commissionAmount: number;
}


export async function recordRefundReversal(
  ledger: LedgerWriterPort,
  input: RefundReversalInput
): Promise<RefundReversalResult> {
  if (!Number.isInteger(input.refundAmountMinor) || input.refundAmountMinor <= 0) {
    throw new Error('refundAmountMinor must be a positive integer in minor units');
  }
  if (!(input.commissionRate >= 0 && input.commissionRate <= 100)) {
    throw new Error('commissionRate must be a percentage between 0 and 100');
  }
  if (!input.refundId) {
    throw new Error('refundId is required for a refund reversal');
  }

  const orderAmount = -input.refundAmountMinor;
  const commissionAmount = -Math.round((input.refundAmountMinor * input.commissionRate) / 100);

  try {
    await ledger.create({
      store: input.store,
      orderId: input.orderId,
      refundId: input.refundId,
      sellerOrderDocId: input.sellerOrderDocId,
      orderAmount,
      commissionRate: input.commissionRate,
      commissionAmount,
      status: 'refunded',
      paymentMethod: input.paymentMethod,
      stripePaymentIntentId: input.stripePaymentIntentId,
      settlementDate: input.settlementDate ?? new Date(),
      settlementRef: 'refund:' + input.refundId,
    });
    return { recorded: true, orderAmount, commissionAmount };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return { recorded: false, orderAmount, commissionAmount };
    }
    throw err;
  }
}
