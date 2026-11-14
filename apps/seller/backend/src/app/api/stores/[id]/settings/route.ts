import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor, SETTINGS_SELECT } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { toStoreSettings } from '@/lib/store-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/settings (Sprint 4 EP-04): the settings screen's data, in the same shape PATCH /api/stores/:id
 * answers. Payout details are masked (last 4 only). Owner only.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'stores', ['name', 'storefront', 'paymentSettings']);
    const { id } = await context.params;
    const doc = await loadOwnedStore(request, ctx, id, SETTINGS_SELECT);
    return NextResponse.json({ settings: await toStoreSettings(doc) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
