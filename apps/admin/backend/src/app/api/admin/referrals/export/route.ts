import { errorResponse } from '@/lib/admin-auth';
import { exportReferralsFor } from '@/lib/admin-referrals';
import { authorizeAdmin } from '@/lib/admin-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/referrals/export?from&to (S8-B6). The rewards as CSV (BOM, formula guard, 5000 rows), audited before it is returned. Owner and finance. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'referrals.read');
    return await exportReferralsFor(request, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
