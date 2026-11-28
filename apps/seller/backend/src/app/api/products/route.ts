import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { productCreateRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { assertProductSlot } from '@/lib/plan';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { parseBody } from '@/lib/placeholder';
import {
  createdFields,
  handleProductError,
  loadSellerProduct,
  prepareProductCreate,
  toSellerProductSummary,
} from '@/lib/products';
import { readProductListPage } from '@/lib/product-list';
import { withSkuGuard } from '@/lib/product-variants';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan, listEnvelope, Product } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/**
 * GET /api/products?q=&status=&sort=&stock=&page=&limit=
 *
 * The products of the seller's store, in the list envelope, plus hasDemoProduct, whatever the page shows.
 *   q       title search, cut to 80 characters
 *   status  all (default) | draft | published, none of which holds a trashed product | trash
 *   sort    newest (default) | oldest | title | price
 *   stock   low: only products with a tracked variant at 5 units or fewer
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'products');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'products.read' });

    // Sprint 9: the query is in lib/product-list.ts, which the phone list uses too.
    const [{ rows, totalDocs, page, limit }, demo] = await Promise.all([
      readProductListPage(storeId, request.nextUrl.searchParams, { defaultLimit: 20, maxLimit: 1000 }),
      Product.exists({ store: storeId, isDemo: true }),
    ]);

    return NextResponse.json(
      { ...listEnvelope(rows.map(toSellerProductSummary), { page, limit, totalDocs }), hasDemoProduct: demo !== null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleProductError(err);
  }
}

/**
 * POST /api/products. Creates a draft in the seller's store and answers 201.
 *
 *   422 (contract)                a store field, or anything else unknown; HTML in the description; no category
 *   422 PRODUCT_SLUG_REQUIRED     no slug was sent and the title holds no Latin letter or digit
 *   422 PRODUCT_CATEGORY_INVALID  a category is not from this store
 *   422 PRODUCT_MEDIA_INVALID     an image is not from this store
 *   422 INVALID_VARIANTS, 409 SKU_TAKEN   see prepareProductVariants. The unique (store, skus) index decides a race
 *   409 PRODUCT_SLUG_TAKEN        said plainly when the holder is in trash (D-041). The unique (store, slug) index decides a race
 *   400 STORE_ID_REQUIRED         no store was named (CO-72)
 *   403 PLAN_LIMIT_REACHED        the plan's product limit is reached (Sprint 6); an edit or a delete is never refused for it
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const body = await parseBody(request, productCreateRequestSchema);
    if (!body.ok) return body.response;
    const data = body.data;
    assertCan(ctx.actor, 'create', 'products', createdFields(data));
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'products.write' });
    // Sprint 6 EP-14 (D-118): after the checks of who and which store, before the write. Over the limit: 403 PLAN_LIMIT_REACHED.
    await assertProductSlot(storeId);

    const document = await prepareProductCreate(storeId, data);
    const created = await withSkuGuard(() => Product.create(document));

    const productId = String(created._id);
    revalidateStoreProduct(storeId, productId);
    return NextResponse.json(await loadSellerProduct(storeId, productId), { status: 201 });
  } catch (err) {
    return handleProductError(err);
  }
}
