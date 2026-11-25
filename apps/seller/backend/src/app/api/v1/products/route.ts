import { v1Read } from '@/lib/api-v1';
import { listV1Products } from '@/lib/api-v1-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/products?limit&cursor&updatedSince (S8-B5). API key with products:read. Read only; other methods are 405. */
export function GET(request: Request): Promise<Response> {
  return v1Read(request, 'products:read', (caller) => listV1Products(caller, new URL(request.url).searchParams));
}
