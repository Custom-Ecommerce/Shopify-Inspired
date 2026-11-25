import type { NextRequest } from 'next/server';
import { listAdminReferrals } from '@/lib/admin-referrals';
import { adminReferralListQuerySchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/referrals { status?, q?, from?, to?, page?, limit? } (S8-B6). Signed by the admin backend only; a seller session means nothing here. Read only;
 * the referred seller is a masked name.
 *   200 { docs, page, limit, totalDocs, totalPages }   401 not signed   422 bad body
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, adminReferralListQuerySchema, (input) => listAdminReferrals(input));
}
