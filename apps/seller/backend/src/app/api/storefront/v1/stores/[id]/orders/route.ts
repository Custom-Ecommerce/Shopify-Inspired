import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { storefrontOrderCreatedResponseSchema } from '@/lib/contracts';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, previewOrderBlocked } from '@/lib/storefront/errors';
import { toOrderCreatedDto } from '@/lib/storefront/order-dto';
import { parseCreateOrderRequest, readJsonBody } from '@/lib/storefront/order-request';
import { placeOrder } from '@/lib/storefront/order-service';
import { carriesPreviewCredential, storefrontFailure } from '@/lib/storefront/preview-request';
import { ORDER_CREATE_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/stores/:id/orders
 *
 * Public guest checkout. Body: { customer: { customerName, phone, address, city? }, lines: [{ productId, qty }],
 * paymentMethod? }, with the retry key in the Idempotency-Key header (or body.idempotencyKey).
 *
 * The server prices the order itself from the catalog: the body has no prices, and any that are sent are
 * ignored. Delivery, totals and stock are all decided here.
 *
 *   201 { data }   order created
 *   200 { data }   the same Idempotency-Key was already used for this order: the first order is returned
 *                  (header Idempotent-Replayed: true), nothing new is saved and no stock moves
 *   400 INVALID_REQUEST | EMPTY_ORDER | INVALID_QUANTITY | PAYMENT_METHOD_UNAVAILABLE
 *   404 STORE_NOT_FOUND    403 STORE_NOT_ACTIVE
 *   409 OUT_OF_STOCK (productId)   409 IDEMPOTENCY_CONFLICT (the key was used for a different order)
 *   422 VARIANT_REQUIRED (productId)  a product with several variants and no variantId
 *   422 UNKNOWN_VARIANT (productId)   the variantId is not a variant of that product
 *   422 UNKNOWN_PRODUCT (productId)   unknown, other store, or unpublished
 *   422 PREVIEW_ORDER_BLOCKED   the request carries a preview credential, good or not: nothing is read or saved
 *   429 RATE_LIMITED       503 STOREFRONT_UNAVAILABLE
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const preview = carriesPreviewCredential(request);
  try {
    if (preview) throw previewOrderBlocked();
    const { id } = await context.params;
    assertStoreId(id);
    enforceRateLimit(ORDER_CREATE_LIMIT, id, request.headers);
    const store = await loadActiveStore(id);

    const parsed = parseCreateOrderRequest(await readJsonBody(request), request.headers.get('idempotency-key'));

    if (parsed.paymentMethod === 'cod' && !store.codEnabled) {
      throw new StorefrontHttpError(400, 'PAYMENT_METHOD_UNAVAILABLE', 'Cash on delivery is not available for this store.');
    }
    if (parsed.paymentMethod === 'card') {
      // Card checkout needs a hosted payment step this API does not have yet. Refuse it plainly.
      throw new StorefrontHttpError(400, 'PAYMENT_METHOD_UNAVAILABLE', 'Card payments are not available yet.');
    }

    const { order, replayed } = await placeOrder(id, store, parsed);

    const body = storefrontOrderCreatedResponseSchema.parse({ data: toOrderCreatedDto(order) });
    return NextResponse.json(body, {
      status: replayed ? 200 : 201,
      headers: replayed ? { ...PRIVATE_NO_STORE_HEADERS, 'Idempotent-Replayed': 'true' } : PRIVATE_NO_STORE_HEADERS,
    });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
