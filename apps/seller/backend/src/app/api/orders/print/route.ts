import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { OrderPrintResponse, OrderPrintSheet } from '@markaz/contracts';
import { authenticate } from '@/lib/auth';
import { orderPrintResponseSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { handleOrderError, ORDER_PRINT_PROJECTION, parseOrderPrintIds, toOrderPrintSheet } from '@/lib/orders';
import { assertCan, Order, ORDER_ACTIONS, Store } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/orders/print?ids=<id>,<id>,...   (1 to 50 ids, duplicates dropped, the order of the first mention kept)
 *
 * The data behind the shipping label, the packing slip and bulk print (EP-02 OB-5b). Store owner only (D-067). It holds the
 * customer's phone and address, so it is never cached and has no customer-facing twin.
 *
 *   200 { store: { name }, orders: [...], skipped: [{ id, reason: not_found | cancelled | returned }] }
 *   400 ORDER_QUERY_INVALID { field: 'ids' }   401   403 admin, or a store the seller does not own
 *
 * An id that is not in this store is reported as not_found, not as an error, so one stale selection cannot stop a batch and
 * another store's order is indistinguishable from one that does not exist.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    // orderPrint is a read with no field list, so this one check is both the role check and the policy check.
    assertCan(ctx.actor, ORDER_ACTIONS.print.operation, ORDER_ACTIONS.print.collection);
    const ids = parseOrderPrintIds(request.nextUrl.searchParams.get('ids'));

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const [rows, store] = await Promise.all([
      Order.find({ _id: { $in: ids }, store: storeId }).select(ORDER_PRINT_PROJECTION).lean(),
      Store.findById(storeId).select('name').lean(),
    ]);
    const byId = new Map((rows as Array<{ _id: unknown; status?: unknown }>).map((row) => [String(row._id).toLowerCase(), row]));

    const orders: OrderPrintSheet[] = [];
    const skipped: OrderPrintResponse['skipped'] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) skipped.push({ id, reason: 'not_found' });
      else if (row.status === 'cancelled' || row.status === 'returned') skipped.push({ id, reason: row.status });
      else orders.push(toOrderPrintSheet(row));
    }

    const name = (store as unknown as { name?: unknown } | null)?.name;
    const body = orderPrintResponseSchema.parse({ store: { name: typeof name === 'string' ? name : '' }, orders, skipped });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleOrderError(err);
  }
}
