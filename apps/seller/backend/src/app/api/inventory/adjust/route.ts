import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { inventoryAdjustRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError } from '@/lib/http';
import { adjustInventory } from '@/lib/inventory';
import { connectSellerDb } from '@/lib/mongo';
import { parseBody } from '@/lib/placeholder';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/adjust { lines: [{ productId, variantId, delta | setTo, reason }] }
 *
 * The only way an existing variant's stock changes (D-034). Each line succeeds or fails alone and answers in `results`:
 * 200 when at least one line was applied. When none was, 422, with the same body plus `errors` for the proxy to carry.
 * A line's own failure says why: 404 PRODUCT_NOT_FOUND (also a trashed product or another store's), 404 VARIANT_NOT_FOUND,
 * 422 VARIANT_NOT_TRACKED, 422 STOCK_WOULD_GO_NEGATIVE, 409 STOCK_CHANGED, 500 STOCK_WRITE_FAILED.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const body = await parseBody(request, inventoryAdjustRequestSchema);
    if (!body.ok) return body.response;
    assertCan(ctx.actor, 'update', 'inventory', ['stockQuantity']);
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const outcome = await adjustInventory(storeId, ctx.userObjectId, body.data.lines);

    const changed = new Set(outcome.results.flatMap((result) => (result.ok && result.delta !== 0 ? [result.productId] : [])));
    await Promise.all([...changed].map((productId) => revalidateStoreProduct(storeId, productId)));

    if (outcome.succeeded > 0) return NextResponse.json(outcome);
    const errors = outcome.results.flatMap((result) =>
      result.ok ? [] : [{ message: result.message, code: result.code, productId: result.productId, variantId: result.variantId }],
    );
    return NextResponse.json({ ...outcome, errors }, { status: 422 });
  } catch (err) {
    return handleRouteError(err);
  }
}
