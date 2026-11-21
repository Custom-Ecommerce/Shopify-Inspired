import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { isObjectId } from '@/lib/admin-stores';
import { hideReview, unhideReview } from '@/lib/seller-moderation-client';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = ['hide', 'unhide'] as const;

/**
 * POST /api/admin/reviews/hide { reviewId, reason } and POST /api/admin/reviews/unhide { reviewId } (Sprint 5 EP-21.US01.T05, D-108). Hide sets the
 * review's status to rejected with the reason (it leaves the storefront and the product's rating); unhide shows it again. The operator is the
 * session's, never the body's. The reason's rules are checked here for presence and again by the seller backend, which owns the contract and the
 * audit entry (ids only: the reason is kept on the review, never in the log).
 */
export async function POST(request: Request, context: { params: Promise<{ action: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    const { action } = await context.params;
    if (!(ACTIONS as readonly string[]).includes(action)) throw new AdminHttpError(404, 'Not found');
    requirePolicy(() => assertCan('admin', 'update', 'reviews', ['status', 'hiddenReason', 'hiddenAt', 'hiddenBy']));

    const body = (await request.json().catch(() => null)) as { reviewId?: unknown; reason?: unknown } | null;
    const reviewId = body?.reviewId;
    if (typeof reviewId !== 'string' || !isObjectId(reviewId)) throw new AdminHttpError(422, 'reviewId must be a 24-character ObjectId');

    if (action === 'unhide') return Response.json(await unhideReview(userId, reviewId), { status: 200, headers: NO_STORE });
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) throw new AdminHttpError(422, 'Give a reason of at least 3 characters.');
    return Response.json(await hideReview(userId, reviewId, reason), { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
