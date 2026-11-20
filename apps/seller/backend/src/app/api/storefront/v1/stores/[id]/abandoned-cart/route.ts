import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { abandonedCartRequestSchema } from '@/lib/contracts';
import { saveAbandonedCart } from '@/lib/abandoned-carts';
import { PRIVATE_NO_STORE_HEADERS, handleStorefrontError } from '@/lib/storefront/errors';
import { invalidBody, readJsonBody } from '@/lib/storefront/order-request';
import { carriesPreviewCredential } from '@/lib/storefront/preview-request';
import { ABANDONED_CART_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/storefront/v1/stores/:id/abandoned-cart   body: { phone, email?, consent: true, lines: [{ productId, variantId?, qty }] }
 * (Sprint 5 EP-28.US01.T02, D-107)
 *
 * The checkout calls this ONCE (debounced) after the shopper typed a valid phone and was shown the consent line ("We may message you about this
 * cart"). It keeps ONE open cart per store and phone (a repeat refreshes it) for 7 days. Nothing is stored without a valid phone AND consent: a
 * body without them is refused before anything is read. The lines are product ids and quantities only: the server prices them from the catalog
 * (names, unit prices and the total), and any price or total in the body is ignored. Rate limited per client address. A preview credential
 * stores nothing (a seller testing their store leaves no cart). The shopper's checkout never waits on this and ignores its failures.
 *
 *   200 { data: { saved: true } }
 *   400 INVALID_REQUEST { field }   phone, consent, lines (empty, or none can be bought), a bad quantity
 *   404 STORE_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(ABANDONED_CART_LIMIT, id, request.headers);
    const store = await loadActiveStore(id);

    const parsed = abandonedCartRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw invalidBody(parsed.error);
    // A seller's preview is not a shopper: nothing is saved, and the answer reads as saved so the page behaves the same.
    if (!carriesPreviewCredential(request)) await saveAbandonedCart(id, store, parsed.data);
    return NextResponse.json({ data: { saved: true } }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
