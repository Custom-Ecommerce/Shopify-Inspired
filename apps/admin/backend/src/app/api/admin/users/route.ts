import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { inviteFor, listUsersFor } from '@/lib/admin-user-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/users and POST /api/admin/users {name, email, adminLevel} (Sprint 6 S6-B6, D-118). Owner level only (users.manage). The invitation
 * is an email with a 7 day single-use link. 400 names the field; 409 EMAIL_TAKEN.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request, 'users.manage');
    return await listUsersFor();
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'users.manage');
    return await inviteFor(request, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
