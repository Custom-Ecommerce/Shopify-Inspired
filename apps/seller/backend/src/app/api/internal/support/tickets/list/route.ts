import type { NextRequest } from 'next/server';
import { internalSupportListSchema } from '@/lib/contracts';
import { listAdminTickets } from '@/lib/admin-support';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/support/tickets/list (Sprint 7, S7-B4). Signed by the admin backend only (MODERATION_API_SECRET); a seller session means nothing here. Lists every seller's tickets, newest activity first. 200 { docs, page, limit, totalDocs, totalPages }. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalSupportListSchema, (input) => listAdminTickets(input));
}
