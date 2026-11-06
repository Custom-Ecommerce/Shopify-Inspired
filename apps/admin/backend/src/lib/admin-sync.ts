import { DEFAULT_LIMIT, MAX_LIMIT, MAX_PAGE, readInteger, toIso, type Doc, type Issue } from '@/lib/admin-stores';

/** Pure helpers for the admin sync outbox view: query parsing and the wire shape of one event. No I/O. */

export const SYNC_STATUSES = ['pending', 'sent', 'dead'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];
export const SYNC_TARGETS = ['admin', 'seller'] as const;

/** The event list shows dead letters unless another status is asked for. */
export const DEFAULT_SYNC_STATUS: SyncStatus = 'dead';

/** An error message can be long. The console shows the start of it, never the payload of the event. */
export const LAST_ERROR_MAX = 500;

export interface SyncListQuery {
  page: number;
  limit: number;
  status: SyncStatus;
}

export type ParsedSyncQuery = { ok: true; query: SyncListQuery } | { ok: false; issues: Issue[] };

export function parseSyncQuery(params: URLSearchParams): ParsedSyncQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const rawStatus = params.get('status') ?? '';
  let status: SyncStatus = DEFAULT_SYNC_STATUS;
  if (rawStatus !== '') {
    if ((SYNC_STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as SyncStatus;
    else issues.push({ path: 'status', message: 'must be one of ' + SYNC_STATUSES.join(', ') });
  }
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, status } };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** One outbox event on the wire. The payload is left out on purpose: it can carry store data. */
export function toSyncEvent(doc: Doc) {
  const error = typeof doc.lastError === 'string' && doc.lastError !== '' ? doc.lastError.slice(0, LAST_ERROR_MAX) : null;
  return {
    id: String(doc._id),
    eventId: text(doc.eventId),
    target: doc.target === 'admin' ? ('admin' as const) : ('seller' as const),
    entity: text(doc.entity),
    entityId: text(doc.entityId),
    group: text(doc.group),
    revision: count(doc.revision),
    status: doc.status as SyncStatus,
    attempts: count(doc.attempts),
    nextAttemptAt: toIso(doc.nextAttemptAt),
    lastError: error,
    sentAt: toIso(doc.sentAt),
    createdAt: toIso(doc.createdAt) ?? new Date(0).toISOString(),
  };
}
