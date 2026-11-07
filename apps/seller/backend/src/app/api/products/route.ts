import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ProductListSort, ProductListStatus } from '@markaz/contracts';
import { authenticate } from '@/lib/auth';
import { PRODUCT_LIST_SORTS, PRODUCT_LIST_STATUSES, productCreateRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { parseBody } from '@/lib/placeholder';
import {
  createdFields,
  handleProductError,
  loadSellerProduct,
  prepareProductCreate,
  toSellerProductSummary,
  type SellerProductRow,
} from '@/lib/products';
import { withSkuGuard } from '@/lib/product-variants';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan, listEnvelope, Product } from '@/lib/services';
import { escapeRegex } from '@/lib/storefront/product-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEARCH_MAX_LENGTH = 80;
/** The overview's "low stock" count: a tracked variant at or below this many units. */
const LOW_STOCK_UNITS = 5;

/** Only what a list row needs. media is cut to its first entry. */
const LIST_PROJECTION = {
  title: 1,
  slug: 1,
  isPublished: 1,
  isDemo: 1,
  isFeatured: 1,
  hideWhenOutOfStock: 1,
  deletedAt: 1,
  deletedBy: 1,
  moderation: 1,
  description: 1,
  highlights: 1,
  minPrice: 1,
  'variants.price': 1,
  'variants.compareAtPrice': 1,
  'variants.trackQuantity': 1,
  'variants.stockQuantity': 1,
  'variants.lowStockThreshold': 1,
  'variants.position': 1,
  categories: 1,
  media: { $slice: 1 },
  createdAt: 1,
  updatedAt: 1,
};

const SORT_SPECS: Record<ProductListSort, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  title: { title: 1, _id: 1 },
  price: { minPrice: 1, _id: 1 },
};

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T, name: string): T {
  const value = (raw ?? '').trim();
  if (value === '') return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new HttpError(422, name + ' must be one of: ' + allowed.join(', '));
  return value as T;
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
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 1000);
    const status = oneOf<ProductListStatus>(params.get('status'), PRODUCT_LIST_STATUSES, 'all', 'status');
    const sort = oneOf<ProductListSort>(params.get('sort'), PRODUCT_LIST_SORTS, 'newest', 'sort');
    const stock = oneOf(params.get('stock'), ['any', 'low'] as const, 'any', 'stock');
    const q = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH).trim();

    // $type, not $ne: null. The trash index is partial on $type, and a query only uses it when it matches that condition.
    const filter: Record<string, unknown> = { store: storeId, deletedAt: status === 'trash' ? { $type: 'date' } : null };
    if (status === 'draft' || status === 'published') filter.isPublished = status === 'published';
    if (q !== '') filter.title = { $regex: escapeRegex(q), $options: 'i' };
    if (stock === 'low') {
      filter.variants = { $elemMatch: { trackQuantity: true, stockQuantity: { $lte: LOW_STOCK_UNITS } } };
    }

    const [rows, totalDocs, demo] = await Promise.all([
      Product.find(filter)
        .select(LIST_PROJECTION)
        .sort(SORT_SPECS[sort])
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'categories', select: 'name slug' })
        .populate({ path: 'media', select: 'url alt' })
        .lean() as unknown as Promise<SellerProductRow[]>,
      Product.countDocuments(filter),
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
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const body = await parseBody(request, productCreateRequestSchema);
    if (!body.ok) return body.response;
    const data = body.data;
    assertCan(ctx.actor, 'create', 'products', createdFields(data));
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const document = await prepareProductCreate(storeId, data);
    const created = await withSkuGuard(() => Product.create(document));

    const productId = String(created._id);
    await revalidateStoreProduct(storeId, productId);
    return NextResponse.json(await loadSellerProduct(storeId, productId), { status: 201 });
  } catch (err) {
    return handleProductError(err);
  }
}
