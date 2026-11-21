import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CONTACT_BLOCKED_MESSAGE, DEFAULT_FRAUD_SETTINGS, storefrontOrderCreatedResponseSchema } from '@/lib/contracts';
import { assessNewOrder, isContactBlocked } from '@/lib/fraud';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, previewOrderBlocked } from '@/lib/storefront/errors';
import { cardCheckoutUrl } from '@/lib/storefront/card-payment';
import { issueOrderAccessToken } from '@/lib/storefront/order-access';
import { toOrderCreatedDto } from '@/lib/storefront/order-dto';
import { parseCreateOrderRequest, readJsonBody } from '@/lib/storefront/order-request';
import { placeOrder } from '@/lib/storefront/order-service';
import { carriesPreviewCredential, storefrontFailure } from '@/lib/storefront/preview-request';
import { ORDER_CREATE_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';
import { notifyOrderPlaced } from '@/lib/notifications';
import { markCartRecovered } from '@/lib/abandoned-carts';
import { phoneKeyOf } from '@/lib/storefront/order-phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/stores/:id/orders
 *
 * Public guest checkout. Body: { customer: { customerName, phone, address, city, email?, note? }, lines: [{ productId, qty }],
 * paymentMethod?, discountCode? }, with the retry key in the Idempotency-Key header (or body.idempotencyKey).
 *
 * The server prices the order itself from the catalog: the body has no prices, and any that are sent are
 * ignored. Delivery, totals and stock are all decided here.
 *
 * A card order is placed first, like cash on delivery, and the answer carries data.checkoutUrl, where the shopper pays (D-082).
 *
 *   201 { data }   order created
 *   200 { data }   the same Idempotency-Key was already used for this order: the first order is returned
 *                  (header Idempotent-Replayed: true), nothing new is saved and no stock moves
 *   400 INVALID_REQUEST | EMPTY_ORDER | INVALID_QUANTITY. A bad input also names its `field`, e.g. customer.phone
 *   422 PAYMENT_METHOD_UNAVAILABLE   the store does not offer this method (Sprint 4: 422, it was 400)
 *   422 CONTACT_BLOCKED    the phone (compared as its normalized form) or the email is on the store's blocklist (Sprint 5 EP-11.US02).
 *                          Checked right after the method checks and BEFORE placeOrder, so nothing is reserved. The message is
 *                          neutral and never says the contact is blocked.
 *   404 STORE_NOT_FOUND    403 STORE_NOT_ACTIVE
 *   409 OUT_OF_STOCK (productId)   409 IDEMPOTENCY_CONFLICT (the key was used for a different order)
 *   422 VARIANT_REQUIRED (productId)  a product with several variants and no variantId
 *   422 UNKNOWN_VARIANT (productId)   the variantId is not a variant of that product
 *   422 UNKNOWN_PRODUCT (productId)   unknown, other store, or unpublished
 *   422 PREVIEW_ORDER_BLOCKED   the request carries a preview credential, good or not: nothing is read or saved
 *   502 PAYMENT_NOT_STARTED   Stripe could not start the payment: the order was cancelled, and its stock and code use returned
 *   409 DISCOUNT_USED_UP (reason)   the code's last use is gone: no order exists
 *   422 DISCOUNT_REJECTED (reason)  any other reason the code cannot be used: no order exists
 *   429 RATE_LIMITED       503 STOREFRONT_UNAVAILABLE
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const preview = carriesPreviewCredential(request);
  try {
    if (preview) throw previewOrderBlocked();
    const { id } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(ORDER_CREATE_LIMIT, id, request.headers);
    const store = await loadActiveStore(id);

    const parsed = parseCreateOrderRequest(await readJsonBody(request), request.headers.get('idempotency-key'));

    // Sprint 4 EP-04.US03 (SM-11): a method the store does not offer is refused with 422, even when the browser sends it.
    if (parsed.paymentMethod === 'cod' && !store.codEnabled) {
      throw new StorefrontHttpError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Cash on delivery is not available for this store.');
    }
    if (parsed.paymentMethod === 'card' && !store.cardEnabled) {
      throw new StorefrontHttpError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Card payments are not available for this store.');
    }

    // Sprint 5 EP-11.US02 (D-107): the blocklist, before anything is priced or reserved.
    if (await isContactBlocked(id, { phone: parsed.customer.phone, email: parsed.customer.email })) {
      throw new StorefrontHttpError(422, 'CONTACT_BLOCKED', CONTACT_BLOCKED_MESSAGE);
    }

    // Sprint 5 EP-11.US01 and US03: the risk rules run on the priced total inside placeOrder, still before any stock moves. They set
    // the order's flags and confirmation status; they never reject it.
    const settings = store.fraud ?? DEFAULT_FRAUD_SETTINGS;
    const { order, replayed } = await placeOrder(id, store, parsed, {
      assess: async (priced) => {
        const context = { storeId: id, settings, paymentMethod: parsed.paymentMethod, total: priced.total, city: parsed.customer.city, phone: parsed.customer.phone };
        try {
          return await assessNewOrder(context);
        } catch (err) {
          // A failed lookup must not lose the order. It fails toward the seller's phone call: a COD order is then left unconfirmed.
          console.error('[seller-backend] could not assess the order risk', err instanceof Error ? err.name : 'unknown');
          const confirm = settings.codConfirmation !== 'off' && parsed.paymentMethod === 'cod';
          return { riskFlags: [], confirmationStatus: confirm ? 'unconfirmed' : 'not_required' };
        }
      },
    });
    // EP-07.US01.T03: after the response, never part of the result. A card order is announced when it is paid (card-webhook.ts),
    // so a shopper who leaves the Stripe page gets no confirmation for an order that is then cancelled.
    if (!replayed && order.paymentMethod !== 'card') notifyOrderPlaced(id, order);

    // Sprint 5 EP-28.US01.T03: an order with the phone key of an open abandoned cart recovers that cart, with the order id, in this same request.
    // Best effort: it logs and never fails the order.
    if (!replayed) await markCartRecovered(id, phoneKeyOf(parsed.customer.phone), order._id);

    const checkoutUrl = order.paymentMethod === 'card' ? await cardCheckoutUrl(id, order, replayed) : null;

    const accessToken = issueOrderAccessToken(order.orderId, id, order.createdAt);

    const body = storefrontOrderCreatedResponseSchema.parse({ data: { ...toOrderCreatedDto(order), checkoutUrl, accessToken } });
    return NextResponse.json(body, {
      status: replayed ? 200 : 201,
      headers: replayed ? { ...PRIVATE_NO_STORE_HEADERS, 'Idempotent-Replayed': 'true' } : PRIVATE_NO_STORE_HEADERS,
    });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
