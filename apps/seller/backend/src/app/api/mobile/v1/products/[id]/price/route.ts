import type { NextRequest } from 'next/server';
import { mobilePriceRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { idempotently, requireIdempotencyKey } from '@/lib/idempotency';
import { conflictResponse, mobileDatabase, mobileError, mobileJson, mobileProductDetail, requireSellerApp, parseMobile, readMobileBody, recordId } from '@/lib/mobile-api';
import { RevisionConflictError } from '@/lib/mobile-revision';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan } from '@/lib/services';
import { setVariantPrice } from '@/lib/variant-price';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/products/:id/price (x-store-id and Idempotency-Key required)   body: { revision, variantId, price, compareAtPrice? }
 *
 * Changes one variant's price (whole rupees) with the portal's own product rules, only while the product is still at the revision the app saw.
 *   200 { changed, product }   409 CONFLICT { current: product }   422 INVALID_VARIANTS or IDEMPOTENCY_KEY_REUSED   400   401   403   404
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'update', 'products', ['variants']);
    const { id } = await context.params;
    const body = parseMobile(await readMobileBody(request), mobilePriceRequestSchema);
    const key = requireIdempotencyKey(request.headers);
    await mobileDatabase();
    recordId(id, 'Product');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'products.write' });

    return await idempotently(ctx, key, 'product.price', { storeId, id, body }, async () => {
      try {
        const { changed } = await setVariantPrice(storeId, id, { variantId: body.variantId, price: body.price, compareAtPrice: body.compareAtPrice }, body.revision);
        if (changed) revalidateStoreProduct(storeId, id);
        return mobileJson({ changed, product: await mobileProductDetail(storeId, id) });
      } catch (err) {
        if (err instanceof RevisionConflictError) return conflictResponse(await mobileProductDetail(storeId, id));
        return mobileError(err);
      }
    });
  } catch (err) {
    return mobileError(err);
  }
}
