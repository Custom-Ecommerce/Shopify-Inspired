import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { loadPeople } from '@/lib/admin-people';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { idOf, isObjectId, toAuditEntry, toDetail, type Doc } from '@/lib/admin-stores';
import { assertCan, AuditLog, Store } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 10;

export interface StoreRouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/admin/stores/:id. One store with its owner and its most recent governance history. */
export async function GET(request: Request, context: StoreRouteContext): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'stores');
      assertCan('admin', 'read', 'users', ['name', 'email']);
      assertCan('admin', 'read', 'audit-log');
    });
    const { id } = await context.params;
    if (!isObjectId(id)) throw new AdminHttpError(404, 'Store not found');

    const store = (await Store.findById(id).lean()) as unknown as Doc | null;
    if (!store) throw new AdminHttpError(404, 'Store not found');

    const rows = (await AuditLog.find({ entity: 'store', entityId: id })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean()) as unknown as Doc[];
    const people = await loadPeople([idOf(store.owner), ...rows.map((row) => idOf(row.actorId))]);
    const history = rows.map((row) => toAuditEntry(row, people));
    return Response.json({ store: toDetail(store, people, history) }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
