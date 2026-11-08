import type { NextRequest } from 'next/server';
import { moderationPermanentDeleteRequestSchema } from '@/lib/contracts';
import { purgeModeratedProduct, moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/moderation/permanent-delete { productId, reason }. Signed only. 409 PRODUCT_NOT_IN_TRASH outside trash. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, moderationPermanentDeleteRequestSchema, purgeModeratedProduct);
}
