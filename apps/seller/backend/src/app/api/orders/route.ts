/* patch_orders_fix: GET /api/orders (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { HttpError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, Order, ORDER_ACTIONS } from '@/lib/services';
import { plainDoc } from '@/lib/seller-scope';
import { ORDER_FIELDS, ORDER_SORT_FIELDS, publicOrder, resolveOwnedStoreId } from '@/lib/data-plane';
import {
  handleOrderError,
  ORDER_LIST_SORT,
  orderListFilters,
  parseOrderListRequest,
  toDashboardOrderListItem,
  toOrderCounts,
} from '@/lib/orders';
import { buildFilter, parseSort, parseWhereParam } from '@/lib/where';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/orders. The orders of ONE store the signed-in seller owns. Only the store owner may call it (D-067): an admin
 * session answers 403, no session 401, a store the seller does not own 403. The store scope always comes from the
 * verified store, never from the query.
 *
 * The seller order list (EP-02 OB-1b): ?status=&from=&to=&q=&page=&limit=
 *   status   one of the order statuses
 *   from,to  YYYY-MM-DD, inclusive, Pakistan time (UTC+05:00)
 *   q        trimmed and cut to 40 characters; ORD-... is an order number prefix, +?digits a phone prefix (03xx is also
 *            tried as +923xx), anything else a case-insensitive name match (D-070)
 *   page     default 1;  limit  default 20, capped at 100
 *   200 { docs, totalDocs, totalPages, page, limit, hasNextPage, hasPrevPage, counts }   newest first. counts covers the
 *       same store, dates and search, without the status filter.
 *   400 ORDER_STATUS_INVALID | ORDER_DATE_INVALID | ORDER_DATE_RANGE_INVALID | ORDER_PAGE_INVALID | ORDER_LIMIT_INVALID
 *
 * Legacy: a request with ?where or ?sort and none of status, from, to or q keeps the generic behaviour it had before:
 * ?where=<json>, ?sort=-createdAt, ?page, ?limit (max 1000), rows as stored minus the idempotency fields, no counts.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection);

    const params = request.nextUrl.searchParams;
    const mode = parseOrderListRequest(params);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    const where = parseWhereParam(params.get('where'));
    const storeId = await resolveOwnedStoreId(request, ctx, where);

    if (mode.mode === 'legacy') {
      const userFilter = buildFilter(where, ORDER_FIELDS);
      const filter = userFilter ? { $and: [{ store: storeId }, userFilter] } : { store: storeId };
      const page = parseIntParam(params.get('page'), 1, 1, 100000);
      const limit = parseIntParam(params.get('limit'), 20, 1, 1000);
      const sort = parseSort(params.get('sort'), ORDER_SORT_FIELDS, { createdAt: -1 });

      const [rows, totalDocs] = await Promise.all([
        Order.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        Order.countDocuments(filter),
      ]);
      const docs = (rows as Record<string, unknown>[]).map((row) => publicOrder(plainDoc(row)));
      return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), { headers: { 'Cache-Control': 'no-store' } });
    }

    const { query } = mode;
    const filters = orderListFilters(storeId, query);
    const [rows, totalDocs, groups] = await Promise.all([
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
    ]);

    const docs = (rows as unknown[]).map(toDashboardOrderListItem);
    return NextResponse.json(
      { ...listEnvelope(docs, { page: query.page, limit: query.limit, totalDocs }), counts: toOrderCounts(groups) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleOrderError(err);
  }
}
