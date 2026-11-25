import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { AnalyticsPeriod } from '@markaz/contracts';
import { buildAnalytics } from '@/lib/analytics';
import { ANALYTICS_PERIODS } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, ORDER_ACTIONS } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics?period=7d|30d|90d. A store's order analytics, funnel and traffic, for the owner or a member with analytics.read (owner and manager).
 * Aggregated by the database (lib/analytics.ts). A seller session only: the admin console has its own orders view and reads no order here (CO-32).
 *   200   401 no session   403 an admin, another store, or a role without analytics.read   422 bad period   503 no database
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection);

    const period = request.nextUrl.searchParams.get('period') ?? '30d';
    if (!(ANALYTICS_PERIODS as readonly string[]).includes(period)) {
      return jsonError(422, 'period must be 7d, 30d, or 90d');
    }

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'analytics.read' });

    return NextResponse.json(await buildAnalytics(storeId, period as AnalyticsPeriod), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
