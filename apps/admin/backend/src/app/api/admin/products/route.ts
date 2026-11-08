import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listModerationProducts } from '@/lib/seller-moderation-client';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILTERS = ['page', 'limit', 'storeId', 'status', 'q'] as const;

/** GET /api/admin/products. Every store's products, read through the seller backend (D-026), which checks the filters. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'read', 'productModeration'));

    const params = new URL(request.url).searchParams;
    const filters = Object.fromEntries(FILTERS.map((name) => [name, params.get(name) ?? undefined]));
    return Response.json(await listModerationProducts(userId, filters), { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
