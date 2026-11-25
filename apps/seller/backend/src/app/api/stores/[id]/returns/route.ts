import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { readAccountBody } from '@/lib/account-support';
import { returnListQuerySchema, RETURN_STATUSES } from '@/lib/contracts';
import { handleRouteError, HttpError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { json } from '@/lib/return-routes';
import { refundCapsForPage, toSellerReturn } from '@/lib/returns';
import { assertCan, Order, Return } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

/**
 * GET /api/stores/:id/returns?status=&page=&limit= (Sprint 5 EP-13.US02.T01, D-107): the store's returns, newest first, paged, with the status
 * filter the seller's tabs send as ?status= (the page used to send where[status][equals], which this backend never read: the tabs did nothing).
 * counts holds the number of returns per status for the tabs.
 *
 * Order: authenticate -> seller only -> parse the query (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId ->
 * findOne({ _id, owner }) -> the returns of THIS store.
 *   401 no session   400 a bad status, page or limit   403 an admin, or another seller's store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const raw: Record<string, string> = {};
    for (const name of ['status', 'page', 'limit']) {
      const value = request.nextUrl.searchParams.get(name);
      if (value !== null && value.trim() !== '') raw[name] = value.trim();
    }
    const query = await readAccountBody(new Request('http://query.invalid', { method: 'POST', body: JSON.stringify(raw) }), returnListQuerySchema);
    assertCan(ctx.actor, 'read', 'returns');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner', 'returns.read');
    const storeId = String(store._id);

    const filter: Row = { store: oid(storeId) };
    if (query.status !== undefined) filter.status = query.status;
    const [rows, totalDocs, groups] = await Promise.all([
      Return.find(filter).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean() as unknown as Promise<Row[]>,
      Return.countDocuments(filter),
      Return.aggregate([{ $match: { store: oid(storeId) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]) as unknown as Promise<Array<{ _id: unknown; count: number }>>,
    ]);

    // The customer's name and payment method come from the orders, read for this page only and only in this store.
    const orderIds = [...new Set(rows.map((row) => String(row.order)))];
    // One query for the page's orders: the lines, subtotal and discount also give each return's refund cap (SB-6, verification bug 8: the list
    // used to send no refundCap, so the page hid "Record a refund"). The caps come from refundCapsForPage, the rule of the detail and the refund.
    const orders = orderIds.length === 0 ? [] : ((await Order.find({ _id: { $in: orderIds }, store: oid(storeId) }).select('customerName paymentMethod items subtotal discountAmount taxAmount taxMode').lean()) as unknown as Row[]);
    const byId = new Map(orders.map((order) => [String(order._id), order]));
    const caps = await refundCapsForPage(storeId, rows, byId);
    const docs = rows.map((row) => {
      const order = byId.get(String(row.order));
      return toSellerReturn(row, {
        paymentMethod: typeof order?.paymentMethod === 'string' ? order.paymentMethod : null,
        customerName: typeof order?.customerName === 'string' ? order.customerName : null,
        refundCap: caps.get(String(row._id)) ?? null,
      });
    });

    const counts: Record<string, number> = Object.fromEntries((RETURN_STATUSES as readonly string[]).map((status) => [status, 0]));
    let all = 0;
    for (const group of groups) {
      const n = typeof group.count === 'number' ? group.count : 0;
      all += n;
      if (String(group._id) in counts) counts[String(group._id)] += n;
    }
    counts.all = all;
    const totalPages = Math.ceil(totalDocs / query.limit);
    return json({ docs, totalDocs, totalPages, page: query.page, limit: query.limit, hasNextPage: query.page < totalPages, hasPrevPage: query.page > 1, counts });
  } catch (err) {
    return handleRouteError(err);
  }
}

