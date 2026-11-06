import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { objectIdSchema, storefrontProductListResponseSchema } from '@/lib/contracts';
import { connectSellerDb } from '@/lib/mongo';
import { Category, Product, Store } from '@/lib/services';
import { PUBLIC_CACHE_HEADERS, StorefrontHttpError, databaseUnavailable, storeNotFound } from '@/lib/storefront/errors';
import { liveListFilter, previewListFilter } from '@/lib/storefront/live-product';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { toValidatedProductSummaries, type ProductRow } from '@/lib/storefront/product-dto';
import { escapeRegex, parseProductListQuery, sortSpec } from '@/lib/storefront/product-query';
import { servesStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only what StorefrontProductSummary needs. media is cut to its first entry (the primary image). */
const LIST_PROJECTION = {
  title: 1,
  slug: 1,
  minPrice: 1,
  'variants._id': 1,
  'variants.price': 1,
  'variants.compareAtPrice': 1,
  'variants.trackQuantity': 1,
  'variants.stockQuantity': 1,
  'variants.lowStockThreshold': 1,
  'variants.position': 1,
  categories: 1,
  avgRating: 1,
  reviewCount: 1,
  media: { $slice: 1 },
};

/** A preview also reads what its tag is made from. */
const PREVIEW_LIST_PROJECTION = { ...LIST_PROJECTION, isPublished: 1, isDemo: 1 };

/**
 * GET /api/storefront/v1/stores/:id/products?category=&q=&sort=&page=&limit=&ids=
 *
 * Public: no session. Lists the published products of one active store. A preview credential good for this store lists
 * everything not in the trash instead, and also works on a pending store. Any other credential is ignored.
 *   limit  1..48, default 24 (clamped)        page  1..1000, default 1 (clamped)
 *   sort   newest (default) | price_asc | price_desc | rating   (anything else is a 400)
 *   q      title search, trimmed, cut to 80 characters
 *   category  a category slug of this store; an unknown slug yields an empty page
 *   ids    comma-separated product ids, at most 48, for a shopper's favourites. Always the Live list, even with a preview
 *          credential, because the answer decides which saved ids are dropped.
 *
 *   404 STORE_NOT_FOUND   malformed or unknown store id
 *   403 STORE_NOT_ACTIVE  the store exists but is not serving (the body carries its status)
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) throw storeNotFound();

    const query = parseProductListQuery(request.nextUrl.searchParams);
    preview = query.ids === null && (await isPreviewRequest(request, id));
    const headers = preview ? PREVIEW_RESPONSE_HEADERS : PUBLIC_CACHE_HEADERS;

    await connectSellerDb().catch(() => {
      throw databaseUnavailable();
    });

    const store = await Store.findById(id).select('status').lean();
    if (!store) throw storeNotFound();
    if (!servesStore(store.status, preview)) {
      throw new StorefrontHttpError(403, 'STORE_NOT_ACTIVE', 'This store is not available.', { status: store.status });
    }

    const emptyPage = () =>
      NextResponse.json(
        storefrontProductListResponseSchema.parse({ data: [], page: query.page, totalPages: 0, totalDocs: 0, limit: query.limit }),
        { headers },
      );

    if (query.ids?.length === 0) return emptyPage();

    const filter = preview ? previewListFilter(id) : liveListFilter(id);
    if (query.ids) filter._id = { $in: query.ids };

    if (query.category) {
      const category = await Category.findOne({ store: id, slug: query.category }).select('_id').lean();
      if (!category) return emptyPage();
      filter.categories = category._id;
    }
    if (query.q) filter.title = { $regex: escapeRegex(query.q), $options: 'i' };

    const [totalDocs, rows] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .select(preview ? PREVIEW_LIST_PROJECTION : LIST_PROJECTION)
        .sort(sortSpec(query.sort))
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate({ path: 'categories', select: 'slug name' })
        .populate({ path: 'media', select: 'url alt' })
        .lean() as unknown as Promise<ProductRow[]>,
    ]);

    const body = storefrontProductListResponseSchema.parse({
      data: toValidatedProductSummaries(rows, preview),
      page: query.page,
      totalPages: Math.ceil(totalDocs / query.limit),
      totalDocs,
      limit: query.limit,
    });

    return NextResponse.json(body, { headers });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
