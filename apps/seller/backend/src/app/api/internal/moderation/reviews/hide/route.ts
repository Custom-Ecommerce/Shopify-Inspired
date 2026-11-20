import type { NextRequest } from 'next/server';
import { reviewHideRequestSchema } from '@/lib/contracts';
import { hideReview, reviewModerationAction } from '@/lib/review-moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/moderation/reviews/hide { reviewId, reason }. Signed only. Hides a shown review (status rejected); a repeat changes nothing. */
export function POST(request: NextRequest): Promise<Response> {
  return reviewModerationAction(request, reviewHideRequestSchema, hideReview);
}
