import type { AdminKpi } from '@markaz/contracts';
import { CommissionEntry, Order, Store, Subscription, User, assertCan } from '@/lib/services';

/**
 * Sprint 6 EP-12 (S6-B5, D-095): the admin overview's KPIs, computed HERE from the NEW CommissionEntry ledger (never the old commissionLedger),
 * the orders and the subscriptions, with Mongo aggregations (no in-memory sums over documents). Whole rupees: baseAmount and balanceEffect are
 * whole rupees in the ledger, so a sum is too; nothing is divided or multiplied by 100.
 *
 *   gateway (card) sales and commission   card_commission entries and the reversals of them
 *   COD order value and orders            cod_commission entries (written even at rate 0, so a 0% COD order still counts)
 *   COD commission                        the same entries and their reversals: minus the sum of balanceEffect (0 at a 0% rate)
 *   unsettled balance                     the sum of balanceEffect of the entries with no settledAt
 *   periods                               today, last 7 and last 30 days, in Asia/Karachi calendar days (UTC+5, no daylight saving)
 */

const DAY_MS = 86_400_000;
const KARACHI_MS = 5 * 3_600_000;
const TYPES = ['card_commission', 'cod_commission'];
export const ORDER_STATUS_KEYS = ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'] as const;

export function periodStarts(now: Date): { today: Date; last7: Date; last30: Date } {
  const dayStart = Math.floor((now.getTime() + KARACHI_MS) / DAY_MS) * DAY_MS - KARACHI_MS;
  return { today: new Date(dayStart), last7: new Date(dayStart - 6 * DAY_MS), last30: new Date(dayStart - 29 * DAY_MS) };
}

const n = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);

/** The ledger rows of a period: the originals and the reversals of them. */
export function ledgerMatch(start: Date, end: Date): Record<string, unknown> {
  return { createdAt: { $gte: start, $lte: end }, $or: [{ type: { $in: TYPES } }, { type: 'reversal', reversesType: { $in: TYPES } }] };
}

const IS_COD = { $or: [{ $eq: ['$type', 'cod_commission'] }, { $eq: ['$reversesType', 'cod_commission'] }] };
const SIGNED_BASE = { $cond: [{ $eq: ['$type', 'reversal'] }, { $multiply: ['$baseAmount', -1] }, '$baseAmount'] };
// One per original; a reversal of a cancelled order takes one off; a return's proportional reversal (it has a returnId) does not.
const ORDER_COUNT = { $cond: [{ $eq: ['$type', 'reversal'] }, { $cond: [{ $ne: [{ $ifNull: ['$returnId', null] }, null] }, 0, -1] }, 1] };

export function periodPipeline(start: Date, end: Date): Array<Record<string, unknown>> {
  return [
    { $match: ledgerMatch(start, end) },
    { $group: { _id: { $cond: [IS_COD, 'cod', 'card'] }, sales: { $sum: SIGNED_BASE }, effect: { $sum: '$balanceEffect' }, orders: { $sum: ORDER_COUNT } } },
  ];
}

export interface KpiPeriod {
  gatewaySales: number;
  commission: number;
  codCommission: number;
  gatewayOrders: number;
  codOrderValue: number;
  codOrders: number;
}

/** Pure: the grouped rows of one period as the wire shape. A group that is missing is zero. */
export function toKpiPeriod(groups: unknown): KpiPeriod {
  const out: KpiPeriod = { gatewaySales: 0, commission: 0, codCommission: 0, gatewayOrders: 0, codOrderValue: 0, codOrders: 0 };
  for (const g of Array.isArray(groups) ? groups : []) {
    const row = g as { _id?: unknown; sales?: unknown; effect?: unknown; orders?: unknown };
    if (row._id === 'card') {
      out.gatewaySales = n(row.sales);
      out.commission = 0 - n(row.effect);
      out.gatewayOrders = Math.max(0, n(row.orders));
    } else if (row._id === 'cod') {
      out.codOrderValue = n(row.sales);
      out.codCommission = 0 - n(row.effect);
      out.codOrders = Math.max(0, n(row.orders));
    }
  }
  return out;
}

/** Pure: the order counts by status, a status with none is 0, anything else is ignored. */
export function toStatusCounts(groups: unknown): AdminKpi['ordersByStatus'] {
  const out = { pending: 0, confirmed: 0, processing: 0, dispatched: 0, delivered: 0, cancelled: 0, returned: 0 };
  for (const g of Array.isArray(groups) ? groups : []) {
    const row = g as { _id?: unknown; count?: unknown };
    if (typeof row._id === 'string' && (ORDER_STATUS_KEYS as readonly string[]).includes(row._id)) out[row._id as keyof typeof out] = Math.max(0, n(row.count));
  }
  return out;
}

/** Pure: sellers by plan and status. Sellers with no subscription are on the Free plan with status "none". */
export function toSellersByPlan(groups: unknown, sellerTotal: number): AdminKpi['sellersByPlan'] {
  const rows: AdminKpi['sellersByPlan'] = [];
  let subscribed = 0;
  for (const g of Array.isArray(groups) ? groups : []) {
    const row = g as { _id?: { planKey?: unknown; status?: unknown }; count?: unknown };
    if (typeof row._id?.planKey !== 'string' || typeof row._id?.status !== 'string') continue;
    const count = Math.max(0, n(row.count));
    subscribed += count;
    rows.push({ planKey: row._id.planKey, status: row._id.status, count });
  }
  const none = Math.max(0, sellerTotal - subscribed);
  if (none > 0) rows.push({ planKey: 'free', status: 'none', count: none });
  return rows.sort((a, b) => b.count - a.count || a.planKey.localeCompare(b.planKey));
}

type Agg = Array<Record<string, any>>;

export async function buildKpi(now: Date = new Date()): Promise<AdminKpi> {
  assertCan('admin', 'read', 'adminOrdersView', ['status', 'total', 'createdAt']);
  const start = periodStarts(now);
  const [today, last7, last30] = (await Promise.all([start.today, start.last7, start.last30].map((from) => CommissionEntry.aggregate(periodPipeline(from, now) as never)))) as Agg[];
  const [unsettled, statusGroups, ordersToday, orders7, orders30, planGroups, sellerTotal, topGroups] = await Promise.all([
    CommissionEntry.aggregate([{ $match: { settledAt: null } }, { $group: { _id: null, total: { $sum: '$balanceEffect' } } }] as never) as unknown as Promise<Agg>,
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }] as never) as unknown as Promise<Agg>,
    Order.countDocuments({ createdAt: { $gte: start.today } } as never),
    Order.countDocuments({ createdAt: { $gte: start.last7 } } as never),
    Order.countDocuments({ createdAt: { $gte: start.last30 } } as never),
    Subscription.aggregate([{ $group: { _id: { planKey: '$planKey', status: '$status' }, count: { $sum: 1 } } }] as never) as unknown as Promise<Agg>,
    User.countDocuments({ role: 'seller' } as never),
    CommissionEntry.aggregate([
      { $match: ledgerMatch(start.last30, now) },
      { $group: { _id: '$store', sales: { $sum: SIGNED_BASE } } },
      { $sort: { sales: -1, _id: 1 } },
      { $limit: 5 },
    ] as never) as unknown as Promise<Agg>,
  ]);
  const ids = topGroups.map((row) => String(row._id));
  const stores = ids.length === 0 ? [] : ((await Store.find({ _id: { $in: ids } } as never).select('name').lean()) as unknown as Array<{ _id: unknown; name?: string }>);
  const names = new Map(stores.map((store) => [String(store._id), store.name ?? null]));
  return {
    periods: { today: toKpiPeriod(today), last7: toKpiPeriod(last7), last30: toKpiPeriod(last30) },
    ordersByPeriod: { today: n(ordersToday), last7: n(orders7), last30: n(orders30) },
    unsettledBalance: n(unsettled[0]?.total),
    ordersByStatus: toStatusCounts(statusGroups),
    sellersByPlan: toSellersByPlan(planGroups, n(sellerTotal)),
    topStores: topGroups.map((row) => ({ storeId: String(row._id), storeName: names.get(String(row._id)) ?? null, sales: n(row.sales) })),
  };
}
