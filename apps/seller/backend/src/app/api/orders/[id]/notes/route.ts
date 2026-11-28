import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate } from '@/lib/auth';
import { orderNoteRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { addOrderNote } from '@/lib/order-note';
import { handleOrderError, readOrderBody, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, ORDER_ACTIONS } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = (): HttpError => new HttpError(404, 'Order not found');

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
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'orders.notes' });

    // Sprint 9: the write is in lib/order-note.ts, which the phone route uses too.
    const updated = await addOrderNote(ctx, storeId, id, body.text);
    return NextResponse.json({ order: toDashboardOrderDetail(updated) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleOrderError(err);
  }
}
