/* patch_orders_fix: GET /api/orders/:id (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Order } from '@/lib/services';
import { plainDoc } from '@/lib/seller-scope';
import { publicOrder, resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/orders/:id. One order of the seller's own store; anything else is a 404. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'orders');
    const { id } = await context.params;

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Order not found');

    const storeId = await resolveOwnedStoreId(request, ctx, null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (Order as any).findOne({ _id: id, store: storeId }).lean();
    if (!row) throw new HttpError(404, 'Order not found');

    return NextResponse.json(publicOrder(plainDoc(row)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
