import type { DashboardOrderListQuery } from '@markaz/contracts';
import { ORDER_LIST_SORT, orderListFilters, toOrderCounts } from '@/lib/orders';
import { Order } from '@/lib/services';

/** The reads of one page of a store's order list (EP-02 OB-1b), shared by GET /api/orders and the phone's list. The caller maps the rows. */
export async function readOrderListPage(storeId: string, query: DashboardOrderListQuery, extra: Record<string, unknown> = {}) {
  const base = orderListFilters(storeId, query);
  // The extra conditions narrow the list and its tab counts alike; they never replace what the query itself filters on (the store among it).
  const filters = { list: { ...extra, ...base.list }, counts: { ...extra, ...base.counts } };
  const [rows, totalDocs, groups, unconfirmedCount] = await Promise.all([
    Order.find(filters.list)
      .sort(ORDER_LIST_SORT)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Order.countDocuments(filters.list),
    Order.aggregate<{ _id: unknown; count: number }>([
      { $match: filters.counts },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Sprint 5 EP-11.US01: how many orders wait for the seller's phone confirmation (for the badge and the dashboard).
    Order.countDocuments({ store: storeId, confirmationStatus: 'unconfirmed', status: { $ne: 'cancelled' } }),
  ]);
  return { rows: rows as unknown[], totalDocs, counts: toOrderCounts(groups), unconfirmedCount };
}
