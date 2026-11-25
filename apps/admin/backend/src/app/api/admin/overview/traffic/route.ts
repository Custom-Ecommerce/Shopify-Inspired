import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { trafficFor } from '@/lib/admin-traffic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/overview/traffic (S8-B7). Read only: the platform's visits and orders per day, the last 14 days, sums only. overview.read. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'overview.read');
    return await trafficFor(userId);
  } catch (err) {
    return errorResponse(err);
  }
}
