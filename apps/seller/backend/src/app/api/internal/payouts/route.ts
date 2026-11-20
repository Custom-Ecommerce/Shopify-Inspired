import type { NextRequest } from 'next/server';
import { createPayoutRequestSchema, payoutListQuerySchema } from '@/lib/contracts';
import { signedQuery } from '@/lib/internal-query';
import { moderationAction } from '@/lib/moderation';
import { createPayout, listPayouts } from '@/lib/payouts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint 4 EP-05.US03 (D-090). Both calls are signed by the admin backend (MODERATION_API_SECRET, like moderation); a seller
 * session means nothing here.
 *
 * GET  /api/internal/payouts?page&limit&storeId&status   the payout history, a payout stuck in pending_settle included
 * POST /api/internal/payouts { storeId, expectedBalance, method, reference, note? }   pays a store its whole balance
 *      409 the balance changed (reload), another payout is in progress, nothing to pay, no payout details;
 *      403 EMAIL_NOT_VERIFIED the owner's email is not verified
 */
export function GET(request: NextRequest): Promise<Response> {
  return signedQuery(request, payoutListQuerySchema, (query) => listPayouts(query));
}

export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, createPayoutRequestSchema, createPayout);
}
