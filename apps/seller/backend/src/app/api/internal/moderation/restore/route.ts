import type { NextRequest } from 'next/server';
import { moderationRestoreRequestSchema } from '@/lib/contracts';
import { restoreModeratedProduct, moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/moderation/restore { productId }. Signed only. 409 PRODUCT_NOT_MODERATED when there is nothing to undo. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, moderationRestoreRequestSchema, restoreModeratedProduct);
}
