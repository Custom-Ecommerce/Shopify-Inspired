import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { productsOf, toSellerReview } from '@/lib/reviews';
import { assertCan, listEnvelope, Review } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** approved = shown, rejected = hidden by an admin, pending is no longer used (Sprint 5 EP-21, D-108). */
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/**
 * GET /api/reviews?status=&unanswered=1&page=&limit= (Sprint 5 EP-21.US02.T01). The seller's store reviews, newest first, in the list
 * envelope. ?status= is approved, rejected or pending (the page's tabs; it used to send where[status][equals], which the backend never
 * read, so the tabs did nothing). ?unanswered=1 keeps the reviews the seller has not replied to. Each row is built field by field
 * (SellerReview): the product's title, the name the shopper chose, the rating, the text, the reply: never a customer, order, phone or email.
 *
 *   200 list envelope   422 an unknown status or unanswered value   401 no session   403 another seller's store (x-store-id)
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'reviews');

    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    if (status !== null && !REVIEW_STATUSES.includes(status)) {
      return jsonError(422, 'status must be pending, approved, or rejected');
    }
    const unanswered = params.get('unanswered');
    if (unanswered !== null && unanswered !== '1' && unanswered !== '0') {
      return jsonError(422, 'unanswered must be 1');
    }
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);

    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);
    const filter: Record<string, unknown> = { store: storeId };
    if (status !== null) filter.status = status;
    if (unanswered === '1') filter.reply = null;

    const [rows, totalDocs] = await Promise.all([
      Review.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Review.countDocuments(filter),
    ]);
    const list = rows as unknown as Record<string, unknown>[];
    const products = await productsOf(list);
    const docs = list.map((row) => toSellerReview(row, products.get(String(row.product)) ?? null));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
