import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { normalizePhoneE164, returnCreateRequestSchema } from '@/lib/contracts';
import { notifyReturnRequested } from '@/lib/notifications';
import { createReturn, loadReturnableOrder } from '@/lib/return-service';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { normalizeOrderId } from '@/lib/storefront/order-id';
import { readJsonBody } from '@/lib/storefront/order-request';
import { RETURN_LIMIT, RETURN_ORDER_LIMIT, enforceRateLimit, enforceRateLimitFor } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';
import { readReturnWindowDays } from '@/lib/store-settings';
import { Order, Store } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/stores/:id/orders/:number/returns   body: { phone, items: [{ productId, variantId, quantity }], reasonCode, note? }
 * (Sprint 5 EP-13.US01.T03, D-107, D-108)
 *
 * A shopper asks to return items of a DELIVERED cash on delivery order, inside the store's return window, up to the quantities not yet asked for
 * (a rejected return does not count). Several partial returns per order are allowed. The credential is the order number plus the phone, the same
 * 404 for a wrong phone or an unknown order. The seller gets one email and one bell alert (return_requested), after the response.
 *
 *   201 { data: { returnNumber, status: 'requested' } }
 *   400 INVALID_REQUEST { field }   404 ORDER_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 *   422 RETURN_NOT_ELIGIBLE { reason }   not delivered, window closed, returns off (0 days), card order, nothing left, or a quantity over what can still be returned
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; number: string }> }): Promise<Response> {
  try {
    const { id, number } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(RETURN_LIMIT, id, request.headers);
    await enforceRateLimitFor(RETURN_ORDER_LIMIT, id, 'order:' + normalizeOrderId(number));
    const store = await loadActiveStore(id);

    const parsed = returnCreateRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.length ? issue.path.map(String).join('.') : null;
      throw new StorefrontHttpError(400, 'INVALID_REQUEST', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid request.'), field ? { field } : {});
    }
    const phone = normalizePhoneE164(parsed.data.phone);
    if (phone === null) throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'phone: enter a valid Pakistani mobile number.', { field: 'phone' });

    const order = await loadReturnableOrder(store.id, number, phone);
    const row = (await Store.findById(store.id).select('storefront').lean()) as unknown as { storefront?: unknown } | null;
    const created = await createReturn(store.id, order, readReturnWindowDays(row?.storefront), phone, parsed.data);

    // After the response, never part of the result: the seller's one email and one bell alert.
    const full = (await Order.findOne({ _id: order._id, store: store.id }).select('orderId customerName customerEmail').lean()) as unknown;
    notifyReturnRequested(store.id, created, full);

    return NextResponse.json({ data: { returnNumber: String(created.returnNumber ?? ''), status: 'requested' } }, { status: 201, headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
