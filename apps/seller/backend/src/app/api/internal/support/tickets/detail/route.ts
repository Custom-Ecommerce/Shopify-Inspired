import type { NextRequest } from 'next/server';
import { internalSupportIdSchema } from '@/lib/contracts';
import { adminTicketDetail } from '@/lib/admin-support';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/support/tickets/detail (Sprint 7, S7-B4). Signed by the admin backend only (MODERATION_API_SECRET); a seller session means nothing here. One ticket with its messages and its seller's name. 404 unknown. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalSupportIdSchema, (input) => adminTicketDetail(input.id));
}
