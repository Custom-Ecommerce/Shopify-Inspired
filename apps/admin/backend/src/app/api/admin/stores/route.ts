import { errorResponse } from '@/lib/admin-auth';
import { loadPeople } from '@/lib/admin-people';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { buildStoreFilter, idOf, listEnvelope, parseStoreListQuery, toListItem, type Doc } from '@/lib/admin-stores';
import { assertCan, Store } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIST_FIELDS = 'name slug status domain isThemeDemo commissionRate commissionMode owner statusChangedAt createdAt';

/**
 * GET /api/admin/stores. The store list for the operator console: search (name, slug, domain, or id), a status
 * filter, and paging, in the list envelope. Newest first.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'stores');
      assertCan('admin', 'read', 'users', ['name', 'email']);
    });

    const parsed = parseStoreListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;
    const filter = buildStoreFilter(query) as never;

    const [rows, totalDocs] = await Promise.all([
      Store.find(filter)
        .select(LIST_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Store.countDocuments(filter),
    ]);
    const docs = rows as unknown as Doc[];
    const people = await loadPeople(docs.map((doc) => idOf(doc.owner)));
    const envelope = listEnvelope(
      docs.map((doc) => toListItem(doc, people)),
      { page: query.page, limit: query.limit, totalDocs },
    );
    return Response.json(envelope, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
