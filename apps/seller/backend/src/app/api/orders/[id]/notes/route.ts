import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate, type AuthContext } from '@/lib/auth';
import { orderNoteRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { handleOrderError, OrderRequestError, readOrderBody, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, Order, ORDER_ACTIONS, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = (): HttpError => new HttpError(404, 'Order not found');

/** The note's text stays out of the audit log: only its length is recorded. */
async function audit(ctx: AuthContext, storeId: string, id: string, orderId: unknown, length: number): Promise<void> {
  try {
    await writeAuditLog('order.note', 'order', id, 'seller:' + ctx.userId, {
      storeId,
      orderId: orderId ?? null,
      length,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order note audit entry', { orderId: id }, err);
  }
}

/**
 * POST /api/orders/:id/notes   body: { text (1..500) }
 *
 * Adds an internal seller note. Never shown to the customer. Store owner only (D-067). At most 100 notes per order: the cap
 * is part of the write's filter ('notes.99' must not exist), so parallel requests cannot go over it.
 *
 *   200 { order }   400 ORDER_BODY_INVALID { field }   401   403 admin or another store   404 bad id, unknown, another store's
 *   422 ORDER_NOTES_FULL
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { operation, collection } = ORDER_ACTIONS.note;
    // The role check first, so an admin is refused whatever the body holds.
    assertCan(ctx.actor, operation, collection, ['text']);
    const { id } = await context.params;

    const body = await readOrderBody(request, orderNoteRequestSchema);
    assertCan(ctx.actor, operation, collection, Object.keys(body));

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const current = (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as { orderId?: string } | null;
    if (!current) throw notFound();

    const updated = await Order.findOneAndUpdate(
      { _id: id, store: storeId, 'notes.99': { $exists: false } },
      { $push: { notes: { text: body.text, by: ctx.userObjectId, at: new Date() } } },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      // The order was there a moment ago, so the filter failed on the cap (unless it has since been removed).
      if (!(await Order.findOne({ _id: id, store: storeId }).lean())) throw notFound();
      throw new OrderRequestError(422, 'ORDER_NOTES_FULL', 'This order already has the maximum of 100 notes.');
    }

    await audit(ctx, storeId, id, current.orderId, body.text.length);
    return NextResponse.json({ order: toDashboardOrderDetail(updated) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleOrderError(err);
  }
}
