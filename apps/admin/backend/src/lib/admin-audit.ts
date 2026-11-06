import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
  MAX_SEARCH_LENGTH,
  escapeRegex,
  isObjectId,
  readInteger,
  toIso,
  type Doc,
  type Issue,
  type Person,
} from '@/lib/admin-stores';

/** Pure helpers for the admin audit log view: query parsing, the Mongo filter, and the wire shape. No I/O. */

/** An action name such as store.suspend. Anything else is refused, so the filter is never a pattern or an operator. */
const ACTION_NAME = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;

export const FACET_LIMIT = 50;

export interface AuditListQuery {
  page: number;
  limit: number;
  q: string | null;
  action: string | null;
}

export type ParsedAuditQuery = { ok: true; query: AuditListQuery } | { ok: false; issues: Issue[] };

export function parseAuditQuery(params: URLSearchParams): ParsedAuditQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const rawQ = (params.get('q') ?? '').trim();
  if (rawQ.length > MAX_SEARCH_LENGTH) issues.push({ path: 'q', message: 'must be at most ' + MAX_SEARCH_LENGTH + ' characters' });
  const rawAction = (params.get('action') ?? '').trim();
  if (rawAction !== '' && !ACTION_NAME.test(rawAction)) issues.push({ path: 'action', message: 'must be an action name such as store.suspend' });
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, q: rawQ === '' ? null : rawQ, action: rawAction === '' ? null : rawAction } };
}

/**
 * The Mongo filter. An id searches the target and the actor exactly. Any other text is matched literally against
 * the action name, so it never becomes a pattern. With both an action and a search, both must hold.
 */
export function buildAuditFilter(query: AuditListQuery): Doc {
  const clauses: Doc[] = [];
  if (query.action !== null) clauses.push({ action: query.action });
  if (query.q !== null) {
    if (isObjectId(query.q)) clauses.push({ $or: [{ entityId: query.q }, { actorId: query.q }] });
    else clauses.push({ action: { $regex: escapeRegex(query.q), $options: 'i' } });
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function record(value: unknown): Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Doc) : {};
}

export function toAuditListEntry(row: Doc, people: Map<string, Person>) {
  const details = record(row.details);
  const actorId = text(row.actorId) ?? '';
  return {
    id: String(row._id),
    action: text(row.action) ?? '',
    entity: text(row.entity) ?? '',
    entityId: text(row.entityId) ?? '',
    actor: { id: actorId, name: people.get(actorId)?.name ?? null },
    reason: text(details.reason),
    note: text(details.note),
    from: text(record(details.before).status),
    to: text(record(details.after).status),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/** The distinct action names for the filter: text only, sorted, and capped. */
export function toActionFacets(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const names = values.filter((value): value is string => typeof value === 'string' && ACTION_NAME.test(value));
  return [...new Set(names)].sort().slice(0, FACET_LIMIT);
}
