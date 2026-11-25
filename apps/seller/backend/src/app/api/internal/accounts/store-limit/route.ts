import type { NextRequest } from 'next/server';
import { internalStoreLimitRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { applyStoreLimitOverride } from '@/lib/store-limit-override';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/accounts/store-limit { userId, storeLimitOverride }. Signed by the admin backend (MODERATION_API_SECRET, like the
 * account status call and moderation); a seller session means nothing here. Sets (an integer of 1 or more) or clears (null) the seller's
 * store-limit override, which wins over the plan, the platform setting and the environment (lib/effective-limits.ts).
 *
 *   200 { userId, storeLimitOverride, changed }   401 not signed   404 unknown seller   409 changed by someone else   422 bad body
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalStoreLimitRequestSchema, applyStoreLimitOverride);
}
