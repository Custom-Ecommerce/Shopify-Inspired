import { errorResponse } from '@/lib/admin-auth';
import { loadPeople } from '@/lib/admin-people';
import { FACET_LIMIT, buildAuditFilter, parseAuditQuery, toActionFacets, toAuditListEntry } from '@/lib/admin-audit';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, AuditLog } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit. The audit log for the operator console, newest first, in the list envelope: filter by action,
 * and search by action text or by a store or operator id. Entries are immutable and this route only reads them. The
 * answer also lists the actions present in the log, for the filter.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'audit-log');
      assertCan('admin', 'read', 'users', ['name', 'email']);
    });

    const parsed = parseAuditQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;
    const filter = buildAuditFilter(query) as never;

    const [rows, totalDocs, actions] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      AuditLog.countDocuments(filter),
      AuditLog.distinct('action'),
    ]);
    const docs = rows as unknown as Doc[];
    const people = await loadPeople(docs.map((doc) => (typeof doc.actorId === 'string' ? doc.actorId : null)));
    const envelope = listEnvelope(
      docs.map((doc) => toAuditListEntry(doc, people)),
      { page: query.page, limit: query.limit, totalDocs },
    );
    return Response.json({ ...envelope, facets: { actions: toActionFacets(actions).slice(0, FACET_LIMIT) } }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
