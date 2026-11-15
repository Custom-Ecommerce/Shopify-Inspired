import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { commissionRateAndSource } from '@/lib/commission';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/commission (Sprint 4 EP-05.US02, D-089): the commission rate that applies to the seller's own store
 * and where it comes from. Read only: a seller cannot set a rate (there is no write route here, and the admin console is the
 * only place a rate changes).
 *
 *   200 { rate, source: 'custom' | 'default' }   a percentage with one decimal; it applies to orders delivered or paid from now
 *   401 no session   403 an admin session or another seller's store   404 unknown store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'stores', ['name']);
    const { id } = await context.params;
    const doc = await loadOwnedStore(request, ctx, id, 'name owner commissionMode commissionRate');
    const { rate, source } = await commissionRateAndSource(doc as unknown as { commissionMode?: unknown; commissionRate?: unknown });
    return NextResponse.json({ rate, source }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
