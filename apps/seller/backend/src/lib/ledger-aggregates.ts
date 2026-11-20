import mongoose from 'mongoose';
import { CommissionEntry, Payout } from '@/lib/services';

/**
 * Sprint 4 EP-05.US04, US06 (D-090): the sums the earnings summary and the commission report are made of. They come from
 * the commission ledger ONLY and are never recomputed from orders, so what a seller sees, what the admin's report shows and
 * what a payout pays are the same numbers.
 *
 * Units are whole rupees. A commission entry's balanceEffect is NEGATIVE (the seller owes it), so the commission is the
 * negated sum; a reversal has the opposite sign and subtracts.
 */

export const COMMISSION_TYPES = ['cod_commission', 'card_commission'] as const;

export const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);

/** The entries that carry commission: the originals and the reversals OF them. card_sale rows are money held, not sales. */
export function commissionRowsMatch(store: string, start: Date, end: Date): Record<string, unknown> {
  return {
    store: oid(store),
    createdAt: { $gte: start, $lt: end },
    $or: [{ type: { $in: [...COMMISSION_TYPES] } }, { type: 'reversal', reversesType: { $in: [...COMMISSION_TYPES] } }],
  };
}

export interface CommissionTotals {
  /** Net item subtotal the commission was taken on (delivery excluded; reversals subtract). */
  sales: number;
  /** Net commission, positive (reversals subtract). */
  commission: number;
  /** Net count of orders: one per original commission entry, minus one per reversal. Never below zero. */
  orders: number;
}

export async function commissionTotals(store: string, start: Date, end: Date): Promise<CommissionTotals> {
  const rows = (await CommissionEntry.aggregate([
    { $match: commissionRowsMatch(store, start, end) },
    {
      $group: {
        _id: null,
        sales: { $sum: { $cond: [{ $eq: ['$type', 'reversal'] }, { $multiply: ['$baseAmount', -1] }, '$baseAmount'] } },
        effect: { $sum: '$balanceEffect' },
        orders: { $sum: { $cond: [{ $eq: ['$type', 'reversal'] }, -1, 1] } },
      },
    },
  ])) as Array<{ sales?: number; effect?: number; orders?: number }>;
  const row = rows[0];
  // 0 - x keeps a clean 0 where the negation of 0 would be -0.
  return { sales: row?.sales ?? 0, commission: 0 - (row?.effect ?? 0), orders: Math.max(0, row?.orders ?? 0) };
}

/** What the platform has not paid out yet: the sum of the unsettled entries (negative: the seller owes the platform). */
export async function unsettledBalance(store: string): Promise<number> {
  const rows = (await CommissionEntry.aggregate([
    { $match: { store: oid(store), settledAt: null } },
    { $group: { _id: null, sum: { $sum: '$balanceEffect' } } },
  ])) as Array<{ sum?: number }>;
  return rows[0]?.sum ?? 0;
}

/** The sum of the store's paid payouts (a voided or failed one is not money paid). */
export async function totalPaidOut(store: string): Promise<number> {
  const rows = (await Payout.aggregate([{ $match: { store: oid(store), status: 'paid' } }, { $group: { _id: null, sum: { $sum: '$amount' } } }])) as Array<{
    sum?: number;
  }>;
  return rows[0]?.sum ?? 0;
}
