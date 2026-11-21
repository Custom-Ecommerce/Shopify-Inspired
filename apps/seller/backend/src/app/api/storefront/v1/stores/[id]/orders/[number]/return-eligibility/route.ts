import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { normalizePhoneE164 } from '@/lib/contracts';
import { eligibilityOf, loadReturnableOrder } from '@/lib/return-service';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { normalizeOrderId } from '@/lib/storefront/order-id';
import { RETURN_LIMIT, RETURN_ORDER_LIMIT, enforceRateLimit, enforceRateLimitFor } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';
import { readReturnWindowDays } from '@/lib/store-settings';
import { Store } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/storefront/v1/stores/:id/orders/:number/return-eligibility?phone= (Sprint 5 EP-13.US01.T03, D-107, D-108)
 *
 * What a shopper may still return from a delivered order: the lines with the delivered and the still returnable quantity, and the state of the
 * store's return window. The credential is the ORDER NUMBER plus the PHONE (normalizePhoneE164, like the track route), not the 24 hour
 * order-access token. A wrong phone, an unknown order and another store's order all give the same 404 ORDER_NOT_FOUND. No name, address or
 * phone comes back. Rate limited per client address AND per order number.
 *
 *   200 { data: { eligible, reason, windowDays, deliveredAt, windowEndsAt, lines } }   400 INVALID_REQUEST (phone)
 *   404 ORDER_NOT_FOUND | STORE_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; number: string }> }): Promise<Response> {
  try {
    const { id, number } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(RETURN_LIMIT, id, request.headers);
    await enforceRateLimitFor(RETURN_ORDER_LIMIT, id, 'order:' + normalizeOrderId(number));
    const store = await loadActiveStore(id);

    const phone = normalizePhoneE164(request.nextUrl.searchParams.get('phone') ?? '');
    if (phone === null) throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'phone: enter a valid Pakistani mobile number.', { field: 'phone' });
    const order = await loadReturnableOrder(store.id, number, phone);
    const windowDays = await storeWindowDays(store.id);
    return NextResponse.json({ data: await eligibilityOf(store.id, order, windowDays) }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}

async function storeWindowDays(storeId: string): Promise<number> {
  const row = (await Store.findById(storeId).select('storefront').lean()) as unknown as { storefront?: unknown } | null;
  return readReturnWindowDays(row?.storefront);
}

