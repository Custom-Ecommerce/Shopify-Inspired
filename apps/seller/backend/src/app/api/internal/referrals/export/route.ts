import type { NextRequest } from 'next/server';
import { exportAdminRewards } from '@/lib/admin-referrals';
import { adminReferralExportQuerySchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/referrals/export { from?, to? } (S8-B6). Signed by the admin backend only. The rewarded referrals, at most 5000. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, adminReferralExportQuerySchema, (input) => exportAdminRewards(input));
}
