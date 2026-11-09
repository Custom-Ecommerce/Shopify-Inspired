import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { storefrontCartQuoteResponseSchema } from '@/lib/contracts';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/storefront/errors';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { loadCartQuote } from '@/lib/storefront/cart-quote-service';
import { parseCartQuoteRequest } from '@/lib/storefront/cart-request';
import { readJsonBody } from '@/lib/storefront/order-request';
import { CART_QUOTE_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/stores/:id/cart/quote
 *
 * Prices a cart from the catalog. Body: { lines: [{ productId, variantId?, qty }] }. Nothing is saved and no stock moves, so a
 * shopper can ask as often as the cart changes. A preview may ask on a pending store; draft and sample lines stay unbuyable.
 *
 *   200 { data }   the priced cart; lines that cannot be bought carry an issue and are left out of the totals
 *   400 INVALID_REQUEST | INVALID_QUANTITY, naming the `field`. An empty cart is 200 with no lines and canCheckout false
 *   422 VARIANT_REQUIRED   a product with several variants and no variantId
 *   404 STORE_NOT_FOUND    403 STORE_NOT_ACTIVE
 *   429 RATE_LIMITED       503 STOREFRONT_UNAVAILABLE
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id } = await context.params;
    assertStoreId(id);
    enforceRateLimit(CART_QUOTE_LIMIT, id, request.headers);
    preview = await isPreviewRequest(request, id);
    const store = await loadActiveStore(id, { preview });

    const parsed = parseCartQuoteRequest(await readJsonBody(request));
    const quote = await loadCartQuote(id, store, parsed.lines);

    const body = storefrontCartQuoteResponseSchema.parse({ data: quote });
    return NextResponse.json(body, { headers: preview ? PREVIEW_RESPONSE_HEADERS : PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
