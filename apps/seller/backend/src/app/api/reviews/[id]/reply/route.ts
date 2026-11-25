import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleRouteError } from '@/lib/http';
import { saveReply } from '@/lib/review-reply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/reviews/:id/reply { reply } (Sprint 5 EP-21.US02.T01, D-108). The seller's FIRST reply to a review: up to 500 characters of plain text,
 * one per review. The product page is revalidated so the reply shows at once. An edit is PATCH /api/reviews/:id.
 *
 *   201 the review   400 ACCOUNT_BODY_INVALID { field }   403 an admin, or another seller's store   404 not this store's review
 *   409 REVIEW_ALREADY_REPLIED   a reply exists already (also the loser of two parallel posts)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await saveReply(request, id, 'create', 'reviews.reply'), { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
