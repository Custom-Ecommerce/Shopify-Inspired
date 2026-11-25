import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { codCommissionRate, commissionRateAndSource } from '@/lib/commission';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/commission (Sprint 4 EP-05.US02, D-089; Sprint 6 D-116): the commission rates that apply to the seller's own
 * store and where the gateway rate comes from. Read only: a seller cannot set a rate (there is no write route here, and the admin console is the
 * only place a rate changes).
 *
 *   200 { gatewayRate, codRate, rate, source }   percentages with one decimal; they apply to orders delivered or paid from now
 *       gatewayRate  card orders: the store's custom rate, else the platform default; source says which ('custom' | 'default')
 *       codRate      cash on delivery: the platform COD percent (0 by default, so COD orders carry no commission); a store's
 *                    custom rate never applies to COD
 *       rate         the same as gatewayRate, kept for the Sprint 4 clients
 *   401 no session   403 an admin session or another seller's store   404 unknown store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'stores', ['name']);
    const { id } = await context.params;
    const doc = await loadOwnedStore(request, ctx, id, 'name owner commissionMode commissionRate', 'commission.read');
    const { rate, source } = await commissionRateAndSource(doc as unknown as { commissionMode?: unknown; commissionRate?: unknown });
    const codRate = await codCommissionRate();
    return NextResponse.json({ gatewayRate: rate, codRate, rate, source }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
