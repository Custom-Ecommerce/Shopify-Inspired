import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { levelFor } from '@/lib/admin-user-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/users/:id/level {adminLevel, reason} (S6-B6). Owner only. 403 SELF_CHANGE for your own account; 409 LAST_OWNER for the last active owner.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'users.manage');
    return await levelFor(request, context, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
