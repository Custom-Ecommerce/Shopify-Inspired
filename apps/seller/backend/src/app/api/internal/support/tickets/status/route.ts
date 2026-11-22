import type { NextRequest } from 'next/server';
import { internalTicketStatusSchema } from '@/lib/contracts';
import { adminTicketStatus } from '@/lib/admin-support';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/support/tickets/status (Sprint 7, S7-B4). Signed by the admin backend only (MODERATION_API_SECRET); a seller session means nothing here. Sets the status under a compare-and-set on the revision. 409 TICKET_REVISION_CONFLICT. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalTicketStatusSchema, (input) => adminTicketStatus(input));
}
