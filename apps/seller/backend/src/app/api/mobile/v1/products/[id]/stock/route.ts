import type { NextRequest } from 'next/server';
import { mobileStockRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { idempotently, requireIdempotencyKey } from '@/lib/idempotency';
import { setStockAtRevision } from '@/lib/inventory';
import { conflictResponse, mobileDatabase, mobileError, mobileJson, mobileProductDetail, requireSellerApp, parseMobile, readMobileBody, recordId } from '@/lib/mobile-api';
import { RevisionConflictError } from '@/lib/mobile-revision';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The reason in the stock history when the app sends none. */
const DEFAULT_REASON = 'Stock count on the phone';

/**
 * POST /api/mobile/v1/products/:id/stock (x-store-id and Idempotency-Key required)   body: { revision, variantId, quantity, reason? }
 *
 * Sets a variant's stock to the count the seller took, only while the product is still at the revision they saw; a sale in between is a conflict, never
 * overwritten.   200 { changed, product }   409 CONFLICT { current: product }   422 VARIANT_NOT_TRACKED or IDEMPOTENCY_KEY_REUSED   400   401   403   404
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'update', 'inventory', ['stockQuantity']);
    const { id } = await context.params;
    const body = parseMobile(await readMobileBody(request), mobileStockRequestSchema);
    const key = requireIdempotencyKey(request.headers);
    await mobileDatabase();
    recordId(id, 'Product');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'inventory.write' });

    return await idempotently(ctx, key, 'product.stock', { storeId, id, body }, async () => {
      try {
        const input = { productId: id, variantId: body.variantId, quantity: body.quantity, reason: body.reason ?? DEFAULT_REASON };
        const { changed } = await setStockAtRevision(storeId, ctx.userObjectId, input, body.revision);
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
