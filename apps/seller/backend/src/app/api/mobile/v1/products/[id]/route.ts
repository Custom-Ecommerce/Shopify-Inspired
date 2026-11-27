import type { NextRequest } from 'next/server';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { mobileDatabase, mobileError, mobileJson, mobileProductDetail, requireSellerApp, recordId } from '@/lib/mobile-api';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/mobile/v1/products/:id (x-store-id required): the product and its variants, with the revision. Another store's product is a 404. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'read', 'products');
    const { id } = await context.params;
    await mobileDatabase();
    recordId(id, 'Product');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'products.read' });
    return mobileJson(await mobileProductDetail(storeId, id));
  } catch (err) {
    return mobileError(err);
  }
}
