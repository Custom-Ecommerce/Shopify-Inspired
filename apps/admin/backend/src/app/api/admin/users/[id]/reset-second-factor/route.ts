import mongoose from 'mongoose';
import { readAdminBody } from '@/lib/admin-account';
import { AdminHttpError, errorResponse, requireDatabase } from '@/lib/admin-auth';
import { setAdminStatusRequestSchema } from '@/lib/admin-user-routes';
import { authorizeAdmin, NO_STORE } from '@/lib/admin-session';
import { auditAdminMobile, revokeAdminMobileDevices } from '@/lib/mobile-auth';
import { secondFactors } from '@/lib/second-factor';
import { User } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/users/:id/reset-second-factor {reason} (Sprint 9, EP-31.US01.T07). Owner only. For a lost authenticator: removes the admin's second
 * factor and signs out every phone of that account; the next phone sign-in enrols again. An owner may reset their own. Audited with the reason.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'users.manage');
    const body = await readAdminBody(request, setAdminStatusRequestSchema);
    await requireDatabase();
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Admin user not found');
    const target = (await User.findById(id).select('role').lean()) as unknown as { role?: unknown } | null;
    if (!target || target.role !== 'admin') throw new AdminHttpError(404, 'Admin user not found');
    const changed = await secondFactors().remove(id);
    await revokeAdminMobileDevices(id, 'device_revoked');
    if (changed) await auditAdminMobile('mobile.totp_reset', id, userId, { reason: body.reason });
    return Response.json({ id, reset: true, changed }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
