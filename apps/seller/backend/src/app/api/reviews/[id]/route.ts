import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { objectIdSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { saveReply } from '@/lib/review-reply';
import { productsOf, toSellerReview } from '@/lib/reviews';
import { assertCan, Review } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/reviews/:id. One review of the seller's store, as the seller reads it. Another store's review answers 404. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'reviews');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const doc = (await Review.findOne({ _id: id, store: storeId }).lean()) as unknown as Record<string, unknown> | null;
    if (!doc) throw new HttpError(404, 'Review not found');
    const products = await productsOf([doc]);
    return NextResponse.json(toSellerReview(doc, products.get(String(doc.product)) ?? null));
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/reviews/:id { reply } (Sprint 5 EP-21.US02.T01, D-108). Edits the seller's reply (up to 500 characters of plain text). The seller
 * can no longer change a review's status: that body is refused with 400 (the admin hides and shows reviews). A first reply is POST /reply.
 *
 *   200 the review   400 ACCOUNT_BODY_INVALID { field }   403 an admin, or another seller's store   404 not this store's review
 *   409 REVIEW_NOT_REPLIED   there is no reply to edit yet
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await saveReply(request, id, 'edit'), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
