import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { normalizePhoneE164, reviewCreateRequestSchema } from '@/lib/contracts';
import { notifyReviewReceived } from '@/lib/notifications';
import { loadReturnableOrder } from '@/lib/return-service';
import { createReview, recomputeProductRating, reviewableProducts } from '@/lib/reviews';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { normalizeOrderId } from '@/lib/storefront/order-id';
import { readJsonBody } from '@/lib/storefront/order-request';
import { REVIEW_LIMIT, REVIEW_ORDER_LIMIT, enforceRateLimit, enforceRateLimitFor } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/stores/:id/orders/:number/reviews   body: { phone, productId, rating, title?, body, displayName? }
 * (Sprint 5 EP-21.US01.T02, D-107, D-108)
 *
 * A shopper reviews a product of a DELIVERED order, once per product per order. The credential is the order number plus the phone, and a
 * wrong phone or an unknown order gives the same 404 as the return routes. The text is plain text (control characters cleaned, the rest kept
 * as typed) and every output escapes it. The review is published at once (status approved, verified), the product's average and count are
 * recomputed, the storefront's product page is revalidated, and the seller gets one email and one bell alert (review_received) after the
 * response. The route acts as the `system` actor (the policy has create as system only).
 *
 *   201 { data: { id, status: 'approved' } }
 *   400 INVALID_REQUEST { field }   404 ORDER_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 *   422 REVIEW_NOT_ELIGIBLE { reason }   not delivered yet, the product is not in the order, or it is already reviewed (also the loser of two parallel posts)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; number: string }> }): Promise<Response> {
  try {
    const { id, number } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(REVIEW_LIMIT, id, request.headers);
    await enforceRateLimitFor(REVIEW_ORDER_LIMIT, id, 'order:' + normalizeOrderId(number));
    const store = await loadActiveStore(id);

    const parsed = reviewCreateRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const unknownKey = issue?.code === 'unrecognized_keys' ? String((issue as { keys?: unknown[] }).keys?.[0] ?? '') : '';
      const field = unknownKey !== '' ? unknownKey : issue?.path.length ? issue.path.map(String).join('.') : null;
      throw new StorefrontHttpError(400, 'INVALID_REQUEST', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid request.'), field ? { field } : {});
    }
    const phone = normalizePhoneE164(parsed.data.phone);
    if (phone === null) throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'phone: enter a valid Pakistani mobile number.', { field: 'phone' });

    const order = await loadReturnableOrder(store.id, number, phone);
    const created = await createReview(store.id, order, parsed.data);
    const productId = String(created.product);

    // The derived average and count, then the storefront's page of this product: best effort, never part of the answer.
    await recomputeProductRating(store.id, productId);
    revalidateStoreProduct(store.id, productId);
    const product = reviewableProducts(order).find((candidate) => candidate.productId.toLowerCase() === productId.toLowerCase());
    notifyReviewReceived(store.id, {
      id: String(created._id),
      productId,
      productTitle: product?.productTitle ?? 'a product',
      rating: Number(created.rating),
      body: String(created.body ?? ''),
      displayName: String(created.displayName ?? ''),
    });

    return NextResponse.json({ data: { id: String(created._id), status: 'approved' } }, { status: 201, headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
