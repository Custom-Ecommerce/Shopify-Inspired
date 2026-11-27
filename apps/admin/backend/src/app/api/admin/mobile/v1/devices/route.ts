import { adminDeviceOf, errorResponse } from '@/lib/admin-auth';
import { ANY_ADMIN, authorizeAdmin } from '@/lib/admin-session';
import { adminMobileDeps } from '@/lib/mobile-auth';
import { activeMobileDevices } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/mobile/v1/devices: the signed-in operator's own phones, whatever their level. No token, family or hash in the answer. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId, tokenVersion } = await authorizeAdmin(request, ANY_ADMIN);
    const rows = await activeMobileDevices(await adminMobileDeps(), userId, tokenVersion);
    const current = adminDeviceOf(request)?.deviceId;
    return Response.json(
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
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
