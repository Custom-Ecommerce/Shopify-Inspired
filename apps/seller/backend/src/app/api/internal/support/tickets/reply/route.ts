import type { NextRequest } from 'next/server';
import { internalTicketReplySchema } from '@/lib/contracts';
import { adminTicketReply } from '@/lib/admin-support';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/support/tickets/reply (Sprint 7, S7-B4). Signed by the admin backend only. { id, revision, text }: the platform answers; ONE compare-and-set on the revision; the seller gets one email. 409 TICKET_REVISION_CONFLICT or TICKET_CLOSED. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalTicketReplySchema, (input, adminId) => adminTicketReply(input, adminId));
}
