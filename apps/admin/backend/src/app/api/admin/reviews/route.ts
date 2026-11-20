import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listModerationReviews } from '@/lib/seller-moderation-client';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILTERS = ['page', 'limit', 'storeId', 'status'] as const;

/**
 * GET /api/admin/reviews?page=&limit=&storeId=&status=approved|rejected (Sprint 5 EP-21.US01.T05). Every store's reviews, newest first, read through
 * the seller backend (D-026), which checks the filters. An operator sees the store, the product, the rating, the text and the name the shopper chose:
 * never a phone, an email or an order.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'read', 'reviews'));

    const params = new URL(request.url).searchParams;
    const filters = Object.fromEntries(FILTERS.map((name) => [name, params.get(name) ?? undefined]));
    return Response.json(await listModerationReviews(userId, filters), { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
