import { v1Read } from '@/lib/api-v1';
import { readV1Order } from '@/lib/api-v1-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/orders/{id} (S8-B5). API key with orders:read. An order of another store is 404. */
export function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return v1Read(request, 'orders:read', async (caller) => readV1Order(caller, (await context.params).id));
}
