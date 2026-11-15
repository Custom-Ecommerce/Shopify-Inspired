import type { NextRequest } from 'next/server';
import { payoutDetailsRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { readFullPayoutDetails } from '@/lib/payouts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/payouts/details { storeId } (signed by the admin backend). The ONE place the full payout account
 * number leaves the seller backend. Admin only, audited every time as payout_details_viewed (the audit entry never holds the
 * number, and the call fails if the entry cannot be written).
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, payoutDetailsRequestSchema, readFullPayoutDetails);
}
