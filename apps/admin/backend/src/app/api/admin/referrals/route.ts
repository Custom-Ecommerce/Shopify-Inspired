import { errorResponse } from '@/lib/admin-auth';
import { listReferralsFor } from '@/lib/admin-referrals';
import { authorizeAdmin } from '@/lib/admin-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/referrals?status&q&from&to&page&limit (S8-B6). Read only. Owner and finance (referrals.read). The referred seller is masked. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'referrals.read');
    return await listReferralsFor(request, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
