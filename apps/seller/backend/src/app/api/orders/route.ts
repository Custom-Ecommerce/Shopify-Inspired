/* patch_orders_fix: GET /api/orders (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, Order } from '@/lib/services';
import { plainDoc } from '@/lib/seller-scope';
import { ORDER_FIELDS, ORDER_SORT_FIELDS, publicOrder, resolveOwnedStoreId } from '@/lib/data-plane';
import { buildFilter, parseSort, parseWhereParam } from '@/lib/where';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/orders. The orders of ONE store the signed-in seller owns, in the list envelope.
 * Supports ?where=<json> (equals, not_equals, in, not_in, greater_than[_equal], less_than[_equal],
 * like/contains, exists, and/or), ?sort=-createdAt, ?page and ?limit (max 1000). The store scope always
 * comes from the verified store, never from the filter.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'orders');

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    const params = request.nextUrl.searchParams;
    const where = parseWhereParam(params.get('where'));
    const storeId = await resolveOwnedStoreId(request, ctx, where);

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
  } catch (err) {
    return handleRouteError(err);
  }
}
