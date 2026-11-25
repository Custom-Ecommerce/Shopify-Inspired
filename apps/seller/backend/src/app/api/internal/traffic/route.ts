import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildAdminTraffic } from '@/lib/admin-traffic';
import { handleRouteError, HttpError } from '@/lib/http';
import { readSignedRequest } from '@/lib/internal-signature';
import { connectSellerDb } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/traffic (S8-B7). Signed by the admin backend only (empty body). The platform's visits and orders of the last 14 UTC days, from the
 * anonymous counters: sums only.
 *   200 { days: [{ day, visits, orders }] }   401 not signed   503 no database
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await buildAdminTraffic(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
