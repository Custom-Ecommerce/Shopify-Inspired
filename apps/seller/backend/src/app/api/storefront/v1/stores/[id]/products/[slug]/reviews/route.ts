import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { STOREFRONT_PRODUCT_SLUG_PATTERN, productReviewsQuerySchema } from '@/lib/contracts';
import { liveProductIdOf, productReviews } from '@/lib/reviews';
import { PUBLIC_CACHE_HEADERS, StorefrontHttpError } from '@/lib/storefront/errors';
import { liveProductFilter, previewProductFilter } from '@/lib/storefront/live-product';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { REVIEW_READ_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const productNotFound = (): StorefrontHttpError => new StorefrontHttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

/**
 * GET /api/storefront/v1/stores/:id/products/:slug/reviews?page=&limit= (Sprint 5 EP-21.US01.T03, D-107)
 *
 * Public: no session. The APPROVED reviews of one published product, newest first, paged (limit at most 50, default 10), with the average
 * (one decimal) and the count of ALL its approved reviews. A hidden review is not here. Each review carries the name the shopper chose, the
 * rating, the text, the date, the verified flag and the seller's reply: no customer, order, phone or email. Cached like the product page
 * (shared cache headers; the storefront reads it under the product's tag, which revalidateStoreProduct drops when a review is published,
 * hidden, shown again or answered).
 *
 *   200 { data: { reviews, summary: { average, count } }, page, totalPages }
 *   400 INVALID_REQUEST (page or limit)   404 STORE_NOT_FOUND | PRODUCT_NOT_FOUND (also a draft)   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; slug: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id, slug: rawSlug } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(REVIEW_READ_LIMIT, id, request.headers);
    preview = await isPreviewRequest(request, id);
    const store = await loadActiveStore(id, { preview });

    let slug: string;
    try {
      slug = decodeURIComponent(rawSlug).trim().toLowerCase();
    } catch {
      throw productNotFound();
    }
    if (!STOREFRONT_PRODUCT_SLUG_PATTERN.test(slug)) throw productNotFound();

    const query = productReviewsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!query.success) {
      const issue = query.error.issues[0];
      const field = issue?.path.length ? issue.path.map(String).join('.') : null;
      throw new StorefrontHttpError(400, 'INVALID_REQUEST', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid request.'), field ? { field } : {});
    }

    const productId = await liveProductIdOf(preview ? previewProductFilter(store.id) : liveProductFilter(store.id), slug);
    if (productId === null) throw productNotFound();
    const body = await productReviews(store.id, productId, query.data.page, query.data.limit);
    return NextResponse.json(body, { headers: preview ? PREVIEW_RESPONSE_HEADERS : PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
