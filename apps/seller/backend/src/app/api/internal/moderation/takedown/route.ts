import type { NextRequest } from 'next/server';
import { moderationTakedownRequestSchema } from '@/lib/contracts';
import { takedownProduct, moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/moderation/takedown { productId, reason }. Signed only. Taking down a taken-down product answers 200 with the record. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, moderationTakedownRequestSchema, takedownProduct);
}
