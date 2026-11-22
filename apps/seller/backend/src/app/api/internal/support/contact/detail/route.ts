import type { NextRequest } from 'next/server';
import { internalSupportIdSchema } from '@/lib/contracts';
import { adminContactDetail } from '@/lib/admin-support';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/support/contact/detail (Sprint 7, S7-B4). Signed by the admin backend only (MODERATION_API_SECRET); a seller session means nothing here. One platform contact message. 404 for a store's message or an unknown id. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalSupportIdSchema, (input) => adminContactDetail(input.id));
}
