import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor, SETTINGS_SELECT } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { storeReadiness } from '@/lib/store-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/readiness (Sprint 4 EP-04.US06, D-094): the go-live checklist of the seller's own store.
 *
 *   200 { ready, status, items: [{ key, ok, label, tab }], missing: [key] }   401   403 admin or another seller's store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'stores', ['name', 'storefront', 'paymentSettings']);
    const { id } = await context.params;
    const doc = await loadOwnedStore(request, ctx, id, SETTINGS_SELECT);
    return NextResponse.json(await storeReadiness(doc, ctx), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
