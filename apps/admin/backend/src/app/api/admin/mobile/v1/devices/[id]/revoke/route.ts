import mongoose from 'mongoose';
import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { ANY_ADMIN, authorizeAdmin } from '@/lib/admin-session';
import { adminMobileDeps, auditAdminMobile } from '@/lib/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/mobile/v1/devices/:id/revoke: signs one of the operator's own phones out. Another account's device is a 404. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, ANY_ADMIN);
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Device not found');
    const deps = await adminMobileDeps();
    const device = await deps.devices.findForUser('admin', userId, id);
    if (!device) throw new AdminHttpError(404, 'Device not found');
    const changed = await deps.devices.revokeFamily(device.family, 'device_revoked', new Date());
    if (changed) await auditAdminMobile('mobile.device_revoked', userId, userId, { device: id });
    return Response.json({ id, revoked: true, changed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
