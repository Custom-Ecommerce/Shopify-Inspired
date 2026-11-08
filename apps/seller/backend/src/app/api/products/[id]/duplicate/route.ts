import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { objectIdSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { duplicateProduct } from '@/lib/product-duplicate';
import type { ProductRouteContext } from '@/lib/product-lifecycle';
import { handleProductError, loadSellerProduct } from '@/lib/products';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/products/:id/duplicate. A draft copy in the same store, answered as the new product. See lib/product-duplicate.ts. */
export async function POST(request: NextRequest, context: ProductRouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'create', 'products', ['title']);
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const copyId = await duplicateProduct(storeId, id);
    return NextResponse.json(await loadSellerProduct(storeId, copyId), { status: 201 });
  } catch (err) {
    return handleProductError(err);
  }
}
