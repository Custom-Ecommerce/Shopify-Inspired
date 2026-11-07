/* patch_orders_fix: GET /api/orders/:id (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Order, ORDER_ACTIONS } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { handleOrderError, toDashboardOrderDetail } from '@/lib/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/orders/:id. One order of the seller's own store, in the dashboard detail shape (EP-02 OB-1b): items with line
 * totals, payment, courier and tracking, statusHistory and notes newest first. Only the store owner may call it (D-067).
 *   401 no session   403 admin, or a store the seller does not own   404 unknown id, or another store's order
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection);
    const { id } = await context.params;

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Order not found');

    const storeId = await resolveOwnedStoreId(request, ctx, null);
    const row = await Order.findOne({ _id: id, store: storeId }).lean();
    if (!row) throw new HttpError(404, 'Order not found');

    return NextResponse.json(toDashboardOrderDetail(row), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleOrderError(err);
  }
}
