import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { normalizePhoneE164 } from '@/lib/contracts';
import { loadReturnableOrder } from '@/lib/return-service';
import { reviewEligibilityOf } from '@/lib/reviews';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { normalizeOrderId } from '@/lib/storefront/order-id';
import { REVIEW_LIMIT, REVIEW_ORDER_LIMIT, enforceRateLimit, enforceRateLimitFor } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/storefront/v1/stores/:id/orders/:number/review-eligibility?phone= (Sprint 5 EP-21.US01.T02, D-107, D-108)
 *
 * The delivered products of an order that have no review yet. The credential is the ORDER NUMBER plus the PHONE (normalizePhoneE164, like
 * the return and track routes), not the 24 hour order-access token. A wrong phone, an unknown order and another store's order all give the
 * same 404 ORDER_NOT_FOUND. No name, address or phone comes back. Rate limited per client address AND per order number.
 *
 *   200 { data: { eligible, reason, items: [{ productId, productTitle }] } }   400 INVALID_REQUEST (phone)
 *   404 ORDER_NOT_FOUND | STORE_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; number: string }> }): Promise<Response> {
  try {
    const { id, number } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(REVIEW_LIMIT, id, request.headers);
    await enforceRateLimitFor(REVIEW_ORDER_LIMIT, id, 'order:' + normalizeOrderId(number));
    const store = await loadActiveStore(id);

    const phone = normalizePhoneE164(request.nextUrl.searchParams.get('phone') ?? '');
    if (phone === null) throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'phone: enter a valid Pakistani mobile number.', { field: 'phone' });
    const order = await loadReturnableOrder(store.id, number, phone);
    return NextResponse.json({ data: await reviewEligibilityOf(store.id, order) }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
