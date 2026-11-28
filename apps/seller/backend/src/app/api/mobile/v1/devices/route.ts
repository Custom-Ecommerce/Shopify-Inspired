import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { NO_STORE } from '@/lib/account-support';
import { authenticate, mobileSessionOf } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { sellerMobileDeps } from '@/lib/mobile-auth';
import { activeMobileDevices } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/devices (EP-31.US01.T03): the phones signed in to the caller's own account, most recently used first.
 *
 *   200 { devices: [{ id, name, platform, appVersion, lastSeenAt, createdAt, current }] }   401   403 not a seller   503
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.role !== 'seller') throw new HttpError(403, 'Only a seller account has devices');
    const rows = await activeMobileDevices(await sellerMobileDeps(), ctx.userId, ctx.tokenVersion);
    const current = mobileSessionOf(ctx)?.deviceId;
    return NextResponse.json(
      {
        devices: rows.map((row) => ({
          id: row.id,
          name: row.name,
          platform: row.platform,
          appVersion: row.appVersion,
          lastSeenAt: row.lastSeenAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          current: row.id === current,
        })),
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
