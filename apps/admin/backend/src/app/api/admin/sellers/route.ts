import { errorResponse } from '@/lib/admin-auth';
import { buildSellerFilter, groupStoresByOwner, parseSellerListQuery, toSellerItem } from '@/lib/admin-sellers';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, Store, User } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sellers. Seller accounts for the operator console: search (name, email, or id) and paging, in the
 * list envelope, newest first. Each seller carries the stores they own. A seller is a user with the seller role;
 * the platform has no separate seller collection yet (ID-33).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'users', ['name', 'email', 'role', 'createdAt']);
      assertCan('admin', 'read', 'stores');
    });

    const parsed = parseSellerListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;
    const filter = buildSellerFilter(query) as never;

    const [rows, totalDocs] = await Promise.all([
      User.find(filter)
        .select('name email createdAt accountStatus')
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    const docs = rows as unknown as Doc[];
    const ids = docs.map((doc) => String(doc._id));
    const stores =
      ids.length === 0
        ? []
        : ((await Store.find({ owner: { $in: ids } } as never)
            .select('name status owner')
            .sort({ createdAt: -1, _id: -1 })
            .lean()) as unknown as Doc[]);
    const byOwner = groupStoresByOwner(stores);
    const envelope = listEnvelope(
      docs.map((doc) => toSellerItem(doc, byOwner.get(String(doc._id)) ?? [])),
      { page: query.page, limit: query.limit, totalDocs },
    );
    return Response.json(envelope, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
