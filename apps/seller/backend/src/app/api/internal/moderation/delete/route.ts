import type { NextRequest } from 'next/server';
import { moderationDeleteRequestSchema } from '@/lib/contracts';
import { deleteModeratedProduct, moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/moderation/delete { productId, reason }. Signed only. 409 PRODUCT_IN_SELLER_TRASH when the seller trashed it first. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, moderationDeleteRequestSchema, deleteModeratedProduct);
}
