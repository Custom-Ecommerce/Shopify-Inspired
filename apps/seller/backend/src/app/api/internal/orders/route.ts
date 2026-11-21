import type { NextRequest } from 'next/server';
import { internalOrderListRequestSchema } from '@/lib/contracts';
import { listAdminOrders } from '@/lib/admin-orders';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/orders { store?, status?, from?, to?, q?, page, limit<=50 } (Sprint 6 S6-B5, D-093). Signed by the admin backend only
 * (MODERATION_API_SECRET); a seller session means nothing here. Read only, SAFE fields only: no name, phone, address or email.
 *   200 { docs, page, limit, totalDocs, totalPages }   401 not signed   422 bad body   503 no database
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalOrderListRequestSchema, (input) => listAdminOrders(input));
}
