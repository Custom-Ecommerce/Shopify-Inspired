import type { NextRequest } from 'next/server';
import { finishPayoutRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { finishPayout } from '@/lib/payouts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/payouts/finish { payoutId } (signed by the admin backend). The idempotent "finish or release" step for
 * a payout left in pending_settle: it becomes paid when the ledger entries it holds are exactly what it says, otherwise its
 * entries are released and it becomes failed. Any other state is answered as it is.
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, finishPayoutRequestSchema, finishPayout);
}
