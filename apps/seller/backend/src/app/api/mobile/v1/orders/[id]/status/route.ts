import type { NextRequest } from 'next/server';
import { mobileOrderStatusRevisionSchema, orderTransitionRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { idempotently, requireIdempotencyKey } from '@/lib/idempotency';
import { conflictResponse, mobileDatabase, mobileError, mobileJson, mobileOrderDetail, requireSellerApp, parseMobile, readMobileBody, recordId } from '@/lib/mobile-api';
import { RevisionConflictError } from '@/lib/mobile-revision';
import { transitionOrder } from '@/lib/order-transition';
import { assertCan, Order, ORDER_ACTIONS } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/orders/:id/status (x-store-id and Idempotency-Key required)
 *   body: { revision, status, note?, courier?, trackingNumber?, trackingUrl? }
 *
 * The portal's status move (same rules, same one compare-and-set, same emails and audit), also conditional on the revision the app saw.
 *   200 { changed, order }   409 CONFLICT { current: order } or IDEMPOTENCY_IN_PROGRESS   422 the transition refusals or IDEMPOTENCY_KEY_REUSED
 *   400   401   403   404
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    const { operation, collection } = ORDER_ACTIONS.transition;
    assertCan(ctx.actor, operation, collection, ['status']);
    const { id } = await context.params;
    const raw = await readMobileBody(request);
    const { revision } = parseMobile(raw, mobileOrderStatusRevisionSchema);
    // The portal's own body rules (unknown keys, revision among them, are dropped).
    const body = parseMobile(raw, orderTransitionRequestSchema);
    assertCan(ctx.actor, operation, collection, Object.keys(body));
    const key = requireIdempotencyKey(request.headers);
    await mobileDatabase();
    recordId(id, 'Order');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'orders.write' });

    const read = async () => mobileOrderDetail(await Order.findOne({ _id: id, store: storeId }).lean());
    return await idempotently(ctx, key, 'order.status', { storeId, id, revision, body }, async () => {
      try {
        const { changed } = await transitionOrder(ctx, storeId, id, body, { revision });
        return mobileJson({ changed, order: await read() });
      } catch (err) {
        if (err instanceof RevisionConflictError) return conflictResponse(await read());
        return mobileError(err);
      }
    });
  } catch (err) {
    return mobileError(err);
  }
}
