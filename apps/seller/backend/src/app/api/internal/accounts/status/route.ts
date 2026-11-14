import type { NextRequest } from 'next/server';
import { applyAccountStatus } from '@/lib/account-status';
import { internalAccountStatusRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/accounts/status { userId, status, reason? }. Signed by the admin backend (MODERATION_API_SECRET,
 * like moderation); a seller session means nothing here. A suspended seller's storefront stays up (D-093): only the
 * account's sessions are refused, the stores are not touched.
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalAccountStatusRequestSchema, applyAccountStatus);
}
