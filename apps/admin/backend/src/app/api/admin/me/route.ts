import { AdminHttpError, errorResponse, requireDatabase, sessionUserOf } from '@/lib/admin-auth';
import { authorizeAdmin, requirePolicy } from '@/lib/admin-session';
import { assertCan, User } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/me. The signed-in operator. The token is verified first, then the account is read again, so a
 * deleted, demoted or suspended operator, and a session from before the last password reset, stop working at once even
 * though the token has not expired (the same gate as every other session-facing admin route: authorizeAdmin).
 * The console's session check calls this route, so it must refuse what the data routes refuse.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    await requireDatabase();
    const user = await User.findById(userId).select('name email role store').lean();
    if (!user || user.role !== 'admin') throw new AdminHttpError(401, 'Invalid or expired session');
    requirePolicy(() => assertCan('admin', 'read', 'users', ['name', 'email', 'role', 'store']));
    return Response.json({ user: sessionUserOf(user) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
