import type { NextRequest } from 'next/server';
import { internalOrderDetailRequestSchema } from '@/lib/contracts';
import { readAdminOrder } from '@/lib/admin-orders';
import { moderationAction } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/orders/detail { orderId } (Sprint 6 S6-B5, D-093). Signed by the admin backend only. Items, totals, status history, payment
 * and confirmation state; no name, phone, address or email. The admin backend writes the audit entry for every read.
 *   200 { order }   401 not signed   404 unknown order   422 bad body
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalOrderDetailRequestSchema, (input) => readAdminOrder(input.orderId));
}
