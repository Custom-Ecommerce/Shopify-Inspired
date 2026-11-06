import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { SYNC_STATUSES, parseSyncQuery, toSyncEvent } from '@/lib/admin-sync';
import { listEnvelope, toIso, type Doc } from '@/lib/admin-stores';
import { assertCan, SyncOutbox } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVENT_FIELDS = 'eventId target entity entityId group revision status attempts nextAttemptAt lastError sentAt createdAt';

/**
 * GET /api/admin/sync/outbox. The health of the admin sync outbox: how many events are pending, sent, and dead, how
 * old the oldest pending one is, when one was last sent, and a page of events in one status (dead letters by
 * default). Read only: draining and repair stay on the signed internal routes. The event payload is never returned.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'read', 'sync-outbox'));

    const parsed = parseSyncQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;

    const [counts, rows, oldest, lastSent] = await Promise.all([
      Promise.all(SYNC_STATUSES.map((status) => SyncOutbox.countDocuments({ status } as never))),
      SyncOutbox.find({ status: query.status } as never)
        .select(EVENT_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      SyncOutbox.findOne({ status: 'pending' } as never)
        .sort({ createdAt: 1 })
        .select('createdAt')
        .lean(),
      SyncOutbox.findOne({ status: 'sent' } as never)
        .sort({ sentAt: -1 })
        .select('sentAt')
        .lean(),
    ]);
    const byStatus = { pending: counts[0], sent: counts[1], dead: counts[2] };
    const events = listEnvelope(
      (rows as unknown as Doc[]).map((doc) => toSyncEvent(doc)),
      { page: query.page, limit: query.limit, totalDocs: byStatus[query.status] },
    );
    return Response.json(
      {
        counts: byStatus,
        oldestPendingAt: toIso((oldest as unknown as Doc | null)?.createdAt),
        lastSentAt: toIso((lastSent as unknown as Doc | null)?.sentAt),
        status: query.status,
        events,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
