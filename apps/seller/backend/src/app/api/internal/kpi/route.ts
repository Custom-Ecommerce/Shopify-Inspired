import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildKpi } from '@/lib/admin-kpi';
import { handleRouteError, HttpError } from '@/lib/http';
import { readSignedRequest } from '@/lib/internal-signature';
import { connectSellerDb } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/kpi (Sprint 6 S6-B5, D-093, D-095). Signed by the admin backend only (empty body). The overview's KPIs from the NEW commission
 * ledger, orders and subscriptions, in whole rupees: gateway sales and commission, COD order value, unsettled balance, orders today / 7 / 30 days,
 * orders by status, sellers by plan and status, and the top 5 stores by sales in the last 30 days. Counts and sums only: no order, no person.
 *   200 { periods, ordersByPeriod, unsettledBalance, ordersByStatus, sellersByPlan, topStores }   401 not signed   503 no database
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await buildKpi(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
