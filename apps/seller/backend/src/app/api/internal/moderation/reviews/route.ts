import type { NextRequest } from 'next/server';
import { reviewModerationList } from '@/lib/review-moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/internal/moderation/reviews?page=&limit=&storeId=&status=approved|rejected (Sprint 5 EP-21.US01.T05). Signed only; limit at most 50. */
export function GET(request: NextRequest): Promise<Response> {
  return reviewModerationList(request);
}
