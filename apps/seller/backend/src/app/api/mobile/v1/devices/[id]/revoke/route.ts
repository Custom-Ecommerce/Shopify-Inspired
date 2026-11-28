import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditAccount, NO_STORE } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { sellerMobileDeps } from '@/lib/mobile-auth';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/devices/:id/revoke (EP-31.US01.T03): signs one of the caller's own phones out. Its access token stops at its next request and its
 * refresh token stops working. Revoking a revoked device is a 200 that changes nothing.
 *
 *   200 { id, revoked: true, changed }   401   403 not a seller   404 a bad id, an unknown device or another account's device   503
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.role !== 'seller') throw new HttpError(403, 'Only a seller account has devices');
    assertCan(ctx.actor, 'update', 'sellerAccount', ['sessions']);
    const { id } = await context.params;
    const deps = await sellerMobileDeps();
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Device not found');
    const device = await deps.devices.findForUser('seller', ctx.userId, id);
    if (!device) throw new HttpError(404, 'Device not found');
    const changed = await deps.devices.revokeFamily(device.family, 'device_revoked', new Date());
    if (changed) await auditAccount(ctx, 'mobile.device_revoked', { device: id });
    return NextResponse.json({ id, revoked: true, changed }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
