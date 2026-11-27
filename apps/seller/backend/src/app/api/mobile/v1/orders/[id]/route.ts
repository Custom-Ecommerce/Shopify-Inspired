import type { NextRequest } from 'next/server';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { mobileDatabase, mobileError, mobileJson, mobileOrderDetail, requireSellerApp, recordId } from '@/lib/mobile-api';
import { assertCan, Order, ORDER_ACTIONS } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/mobile/v1/orders/:id (x-store-id required): the portal's order detail with its revision. Another store's order is a 404. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection);
    const { id } = await context.params;
    await mobileDatabase();
    recordId(id, 'Order');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'orders.read' });
    const row = await Order.findOne({ _id: id, store: storeId }).lean();
    if (!row) throw new HttpError(404, 'Order not found');
    return mobileJson(mobileOrderDetail(row));
  } catch (err) {
    return mobileError(err);
  }
}
