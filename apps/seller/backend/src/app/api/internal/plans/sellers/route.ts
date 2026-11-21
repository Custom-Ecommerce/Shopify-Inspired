import type { NextRequest } from 'next/server';
import { internalSellerPlansRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { buildSellerPlans } from '@/lib/plan-usage';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/plans/sellers { sellerIds } (Sprint 6 EP-14.US02.T08, D-093 pattern). Signed by the admin backend (MODERATION_API_SECRET,
 * like the account status and store-limit calls); a seller session means nothing here. Answers the plan, status, period end, limits and usage of
 * up to 100 sellers, for the admin's sellers page. Read only.
 *
 *   200 { plans: [{ sellerId, plan, status, periodEnd, daysLeft, limits, used }] }   401 not signed   422 bad body
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalSellerPlansRequestSchema, async (input) => {
    assertCan('admin', 'read', 'subscriptions');
    return { plans: await buildSellerPlans(input.sellerIds) };
  });
}
