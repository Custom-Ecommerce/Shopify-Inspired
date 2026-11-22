import type { NextRequest } from 'next/server';
import { internalSupportListSchema } from '@/lib/contracts';
import { listAdminContact } from '@/lib/admin-support';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/support/contact/list (Sprint 7, S7-B4). Signed by the admin backend only (MODERATION_API_SECRET); a seller session means nothing here. Lists the PLATFORM contact messages only (never a store's). 200 { docs, page, limit, totalDocs, totalPages }. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalSupportListSchema, (input) => listAdminContact(input));
}
