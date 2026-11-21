import { errorResponse } from '@/lib/admin-auth';
import { listOrdersFor } from '@/lib/admin-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/orders?store&status&from&to&q&page&limit (Sprint 6 S6-B5). Read only; safe fields only (no name, phone, address or email). 400 names a bad filter. */
export async function GET(request: Request): Promise<Response> {
  try {
    return await listOrdersFor(request);
  } catch (err) {
    return errorResponse(err);
  }
}
