import type { EarningsEntryRow, EarningsPayoutRow, EarningsQuery, EarningsResponse } from '@markaz/contracts';
import { HttpError } from '@/lib/http';
import { commissionTotals, oid, totalPaidOut, unsettledBalance } from '@/lib/ledger-aggregates';
import { ACCOUNT_CODES, karachiDayLabel, resolvePeriod } from '@/lib/contracts';
import { CommissionEntry, Order, Payout } from '@/lib/services';

/**
 * Sprint 4 EP-05.US04 (D-090): the seller's earnings of one store, from the commission ledger only.
 *
 *   summary   the period, Asia/Karachi days: sales = net item subtotal of the commission entries (reversals subtract,
 *             delivery excluded), commission = their net, net = sales - commission.
 *   allTime   balance = what is not yet paid out, totalPaidOut = the paid payouts.
 *   entries   a page of the period's ledger rows, with the order number looked up for THIS page only.
 *   payouts   what the platform paid (and took back).
 *
 * An empty store answers zeros and empty lists, never an error.
 */

interface EntryDoc {
  _id: unknown;
  order: unknown;
  type: EarningsEntryRow['type'];
  reversesType?: EarningsEntryRow['reversesType'];
  balanceEffect: number;
  baseAmount: number;
  rate: number;
  settledAt?: Date | null;
  createdAt: Date;
}

interface PayoutDoc {
  _id: unknown;
  amount: number;
  method: EarningsPayoutRow['method'];
  reference: string;
  status: EarningsPayoutRow['status'];
  createdAt: Date;
}

/** The payouts a seller sees: paid and taken back. A pending_settle or failed one is the platform's own housekeeping. */
export const SELLER_VISIBLE_PAYOUT_STATUSES = ['paid', 'voided'] as const;
const PAYOUTS_SHOWN = 50;

export async function orderNumbersFor(orderIds: readonly string[], storeId: string): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const orders = (await Order.find({ _id: { $in: [...new Set(orderIds)] }, store: storeId })
    .select('orderId')
    .lean()) as unknown as Array<{ _id: unknown; orderId?: string }>;
  return new Map(orders.filter((order) => typeof order.orderId === 'string').map((order) => [String(order._id), order.orderId as string]));
}

export function toEntryRow(entry: EntryDoc, numbers: Map<string, string>): EarningsEntryRow {
  const orderId = String(entry.order);
  return {
    id: String(entry._id),
    type: entry.type,
    reversesType: entry.reversesType ?? null,
    orderId,
    orderNumber: numbers.get(orderId) ?? null,
    amount: entry.balanceEffect === 0 ? 0 : entry.balanceEffect,
    baseAmount: entry.baseAmount,
    rate: entry.rate,
    settled: entry.settledAt !== null && entry.settledAt !== undefined,
    createdAt: new Date(entry.createdAt).toISOString(),
  };
}

export function toPayoutRow(payout: PayoutDoc): EarningsPayoutRow {
  return {
    id: String(payout._id),
    amount: payout.amount,
    method: payout.method,
    reference: payout.reference,
    status: payout.status,
    createdAt: new Date(payout.createdAt).toISOString(),
  };
}

export async function buildEarnings(storeId: string, query: EarningsQuery, now: Date = new Date()): Promise<EarningsResponse> {
  const period = resolvePeriod(query, now);
  if (!period.ok) throw new HttpError(400, period.message, ACCOUNT_CODES.BODY_INVALID, period.field);

  const filter: Record<string, unknown> = {
    store: oid(storeId),
    createdAt: { $gte: period.start, $lt: period.end },
    ...(query.type ? { type: query.type } : {}),
  };

  const [totals, balance, paidOut, rows, totalDocs, payouts] = await Promise.all([
    commissionTotals(storeId, period.start, period.end),
    unsettledBalance(storeId),
    totalPaidOut(storeId),
    CommissionEntry.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<EntryDoc[]>,
    CommissionEntry.countDocuments(filter),
    Payout.find({ store: oid(storeId), status: { $in: [...SELLER_VISIBLE_PAYOUT_STATUSES] } })
      .select('amount method reference status createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAYOUTS_SHOWN)
      .lean() as unknown as Promise<PayoutDoc[]>,
  ]);

  const numbers = await orderNumbersFor(rows.map((row) => String(row.order)), storeId);
  const lastDay = new Date(period.end.getTime() - 1);
  return {
    period: { key: period.period, from: karachiDayLabel(period.start), to: karachiDayLabel(lastDay), start: period.start.toISOString(), end: period.end.toISOString() },
    summary: { sales: totals.sales, commission: totals.commission, net: totals.sales - totals.commission },
    allTime: { balance, totalPaidOut: paidOut },
    entries: { docs: rows.map((row) => toEntryRow(row, numbers)), page: query.page, limit: query.limit, totalDocs, totalPages: Math.ceil(totalDocs / query.limit) },
    payouts: payouts.map(toPayoutRow),
  };
}
