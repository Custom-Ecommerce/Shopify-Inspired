import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { statusFor } from '@/lib/admin-user-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/users/:id/enable {reason} (S6-B6). Owner only. 403 SELF_CHANGE for yourself. The account is never deleted.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'users.manage');
    return await statusFor(request, context, userId, 'active');
  } catch (err) {
    return errorResponse(err);
  }
}
