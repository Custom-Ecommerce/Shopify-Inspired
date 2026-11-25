import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { loadStoreFor, requireSellerActor, SETTINGS_SELECT } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { settingsForRole, toStoreSettings } from '@/lib/store-settings';

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
    // S8-B3: every role that works in the store may read it (capability store.view), each its own view: the owner everything, a manager everything but the payout account,
    // staff and support only the safe subset (settingsForRole): no payment or fraud details, no payout, no domain, no message templates.
    const { doc, role } = await loadStoreFor(request, ctx, id, SETTINGS_SELECT, ['store.view']);
    return NextResponse.json({ settings: settingsForRole(await toStoreSettings(doc), role) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
