import type { NextRequest } from 'next/server';
import { voidPayoutRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { voidPayout } from '@/lib/payouts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/payouts/void { payoutId, reason } (signed by the admin backend). paid -> voided in one compare-and-set,
 * then its entries are released and count in the balance again. A repeat is a harmless 200.
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, voidPayoutRequestSchema, voidPayout);
}
