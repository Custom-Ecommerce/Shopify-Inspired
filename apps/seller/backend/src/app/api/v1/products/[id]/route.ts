import { v1Read } from '@/lib/api-v1';
import { readV1Product } from '@/lib/api-v1-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/products/{id} (S8-B5). API key with products:read. A product of another store is 404. */
export function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return v1Read(request, 'products:read', async (caller) => readV1Product(caller, (await context.params).id));
}
