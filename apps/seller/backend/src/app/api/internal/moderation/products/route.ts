import type { NextRequest } from 'next/server';
import { moderationList } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/internal/moderation/products?page=&limit=&storeId=&status=&q=. Signed only; limit at most 50. */
export function GET(request: NextRequest): Promise<Response> {
  return moderationList(request);
}
