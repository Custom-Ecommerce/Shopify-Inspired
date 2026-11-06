import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { STOREFRONT_PRODUCT_SLUG_PATTERN, storefrontProductDetailResponseSchema } from '@/lib/contracts';
import { Product } from '@/lib/services';
import { PUBLIC_CACHE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { liveProductFilter } from '@/lib/storefront/live-product';
import { toValidatedProductDetail, type ProductDetailRow } from '@/lib/storefront/product-dto';
import { loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only what StorefrontProductDetail needs. Stock counts, reservations and the store id stay on the server. */
const DETAIL_PROJECTION = {
  title: 1,
  slug: 1,
  options: 1,
  variants: 1,
  minPrice: 1,
  categories: 1,
  media: 1,
  avgRating: 1,
  reviewCount: 1,
  description: 1,
  highlights: 1,
  tags: 1,
  deliveryCharge: 1,
  seoTitle: 1,
  seoDescription: 1,
  seoImage: 1,
};

const productNotFound = (): StorefrontHttpError => new StorefrontHttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

/**
 * GET /api/storefront/v1/stores/:id/products/:slug
 *
 * Public: no session. One published product of one active store, in the StorefrontProductDetail shape.
 *
 *   404 STORE_NOT_FOUND    malformed or unknown store id
 *   403 STORE_NOT_ACTIVE   the store exists but is not serving (the body carries its status)
 *   404 PRODUCT_NOT_FOUND  no such slug in this store, or the product is not published. The two are
 *                          indistinguishable on purpose: a draft must not be discoverable.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string; slug: string }> }): Promise<Response> {
  try {
    const { id, slug: rawSlug } = await context.params;

    let slug: string;
    try {
      slug = decodeURIComponent(rawSlug).trim().toLowerCase();
    } catch {
      throw productNotFound();
    }

    const store = await loadActiveStore(id);
    // A slug that cannot be a product never reaches the catalog query.
    if (!STOREFRONT_PRODUCT_SLUG_PATTERN.test(slug)) throw productNotFound();

    const row = (await Product.findOne({ ...liveProductFilter(id), slug })
      .select(DETAIL_PROJECTION)
      .populate({ path: 'categories', select: 'slug name' })
      .populate({ path: 'media', select: 'url alt' })
      .populate({ path: 'seoImage', select: 'url' })
      .lean()) as unknown as ProductDetailRow | null;
    if (!row) throw productNotFound();

    const body = storefrontProductDetailResponseSchema.parse({ data: toValidatedProductDetail(row, store.deliveryRate) });
    return NextResponse.json(body, { headers: PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
