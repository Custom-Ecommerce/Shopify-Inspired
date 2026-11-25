import { v1Read } from '@/lib/api-v1';
import { listV1Orders } from '@/lib/api-v1-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/orders?limit&cursor&updatedSince (S8-B5). API key with orders:read. No customer name, phone, email or address. */
export function GET(request: Request): Promise<Response> {
  return v1Read(request, 'orders:read', (caller) => listV1Orders(caller, new URL(request.url).searchParams));
}
