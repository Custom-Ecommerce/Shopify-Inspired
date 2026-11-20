import type { NextRequest } from 'next/server';
import { reviewUnhideRequestSchema } from '@/lib/contracts';
import { reviewModerationAction, unhideReview } from '@/lib/review-moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/moderation/reviews/unhide { reviewId }. Signed only. Shows a hidden review again (status approved); a repeat changes nothing. */
export function POST(request: NextRequest): Promise<Response> {
  return reviewModerationAction(request, reviewUnhideRequestSchema, unhideReview);
}
