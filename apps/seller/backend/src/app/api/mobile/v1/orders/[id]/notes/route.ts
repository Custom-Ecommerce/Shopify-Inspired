import type { NextRequest } from 'next/server';
import { mobileOrderNoteRevisionSchema, orderNoteRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { idempotently, requireIdempotencyKey } from '@/lib/idempotency';
import { conflictResponse, mobileDatabase, mobileError, mobileJson, mobileOrderDetail, requireSellerApp, parseMobile, readMobileBody, recordId } from '@/lib/mobile-api';
import { RevisionConflictError } from '@/lib/mobile-revision';
import { addOrderNote } from '@/lib/order-note';
import { assertCan, Order, ORDER_ACTIONS } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/orders/:id/notes (x-store-id and Idempotency-Key required)   body: { revision, text }
 *
 * The portal's internal note, conditional on the revision the app saw. A repeat of the same request adds no second note.
 *   200 { order }   409 CONFLICT { current: order }   422 ORDER_NOTES_FULL or IDEMPOTENCY_KEY_REUSED   400   401   403   404
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    const { operation, collection } = ORDER_ACTIONS.note;
    assertCan(ctx.actor, operation, collection, ['text']);
    const { id } = await context.params;
    const raw = await readMobileBody(request);
    const { revision } = parseMobile(raw, mobileOrderNoteRevisionSchema);
    const body = parseMobile(raw, orderNoteRequestSchema);
    assertCan(ctx.actor, operation, collection, Object.keys(body));
    const key = requireIdempotencyKey(request.headers);
    await mobileDatabase();
    recordId(id, 'Order');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'orders.notes' });

    const read = async () => mobileOrderDetail(await Order.findOne({ _id: id, store: storeId }).lean());
    return await idempotently(ctx, key, 'order.note', { storeId, id, revision, body }, async () => {
      try {
        await addOrderNote(ctx, storeId, id, body.text, { revision });
        return mobileJson({ order: await read() });
      } catch (err) {
        if (err instanceof RevisionConflictError) return conflictResponse(await read());
        return mobileError(err);
      }
    });
  } catch (err) {
    return mobileError(err);
  }
}
