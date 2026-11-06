/**
 * Pure helpers for the admin store endpoints: query parsing, the Mongo filter, and the wire shapes. No I/O, so the
 * routes stay thin and these are tested without a database. Wire identity is `id`; `_id` never leaves the backend.
 */

export const STORE_STATUSES = ['pending', 'active', 'suspended', 'archived'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_PAGE = 100000;
export const MAX_SEARCH_LENGTH = 100;

export type Doc = Record<string, unknown>;
export type Issue = { path: string; message: string };

export interface StoreListQuery {
  page: number;
  limit: number;
  q: string | null;
  status: StoreStatus | null;
}

export type ParsedListQuery = { ok: true; query: StoreListQuery } | { ok: false; issues: Issue[] };

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

export function readInteger(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

/** Reads page, limit, q, and status. Anything malformed is refused, not silently ignored. */
export function parseStoreListQuery(params: URLSearchParams): ParsedListQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });

  const rawQ = (params.get('q') ?? '').trim();
  if (rawQ.length > MAX_SEARCH_LENGTH) issues.push({ path: 'q', message: 'must be at most ' + MAX_SEARCH_LENGTH + ' characters' });

  const rawStatus = params.get('status') ?? '';
  let status: StoreStatus | null = null;
  if (rawStatus !== '') {
    if ((STORE_STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as StoreStatus;
    else issues.push({ path: 'status', message: 'must be one of ' + STORE_STATUSES.join(', ') });
  }
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, q: rawQ === '' ? null : rawQ, status } };
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The Mongo filter for a list query. The search text is escaped, so it is matched literally, never as a pattern. */
export function buildStoreFilter(query: StoreListQuery): Doc {
  const filter: Doc = {};
  if (query.status !== null) filter.status = query.status;
  if (query.q !== null) {
    const pattern = { $regex: escapeRegex(query.q), $options: 'i' };
    const or: Doc[] = [{ name: pattern }, { slug: pattern }, { domain: pattern }];
    if (isObjectId(query.q)) or.push({ _id: query.q });
    filter.$or = or;
  }
  return filter;
}

export interface ListEnvelope<T> {
  docs: T[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/** The same fields as the monorepo's list envelope (packages/api-compat). */
export function listEnvelope<T>(docs: T[], meta: { page: number; limit: number; totalDocs: number }): ListEnvelope<T> {
  const totalPages = meta.totalDocs === 0 ? 0 : Math.ceil(meta.totalDocs / meta.limit);
  return {
    docs,
    totalDocs: meta.totalDocs,
    totalPages,
    page: meta.page,
    limit: meta.limit,
    hasNextPage: meta.page < totalPages,
    hasPrevPage: meta.page > 1,
  };
}

export function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function record(value: unknown): Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Doc) : {};
}

export function idOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const asString = String(value);
  return isObjectId(asString) ? asString : null;
}

export interface Person {
  name: string;
  email: string;
}

export function toOwner(ownerValue: unknown, people: Map<string, Person>): { id: string; name: string; email: string } | null {
  const id = idOf(ownerValue);
  if (id === null) return null;
  const person = people.get(id);
  return { id, name: person?.name ?? '(unknown account)', email: person?.email ?? '' };
}

const COMMISSION_MODES = ['inherit', 'custom'];
const DOMAIN_STATUSES = ['unset', 'pending', 'verified', 'failed'];

export function toListItem(doc: Doc, people: Map<string, Person>) {
  const mode = text(doc.commissionMode);
  return {
    id: String(doc._id),
    name: text(doc.name) ?? '',
    slug: text(doc.slug) ?? '',
    status: doc.status as StoreStatus,
    domain: text(doc.domain),
    isThemeDemo: doc.isThemeDemo === true,
    commissionRate: typeof doc.commissionRate === 'number' ? doc.commissionRate : 0,
    commissionMode: mode !== null && COMMISSION_MODES.includes(mode) ? mode : 'inherit',
    owner: toOwner(doc.owner, people),
    statusChangedAt: toIso(doc.statusChangedAt),
    createdAt: toIso(doc.createdAt) ?? new Date(0).toISOString(),
  };
}

export interface AuditEntryWire {
  id: string;
  action: string;
  actor: { id: string; name: string | null };
  reason: string | null;
  note: string | null;
  from: string | null;
  to: string | null;
  createdAt: string;
}

export function toAuditEntry(row: Doc, actorNames: Map<string, Person>): AuditEntryWire {
  const details = record(row.details);
  const actorId = text(row.actorId) ?? '';
  return {
    id: String(row._id),
    action: text(row.action) ?? '',
    actor: { id: actorId, name: actorNames.get(actorId)?.name ?? null },
    reason: text(details.reason),
    note: text(details.note),
    from: text(record(details.before).status),
    to: text(record(details.after).status),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

export function toDetail(doc: Doc, people: Map<string, Person>, history: AuditEntryWire[]) {
  const storefront = record(doc.storefront);
  const billing = record(doc.billing);
  const domainStatus = text(doc.customDomainStatus);
  return {
    ...toListItem(doc, people),
    internalHandle: text(doc.internalHandle),
    customDomainStatus: domainStatus !== null && DOMAIN_STATUSES.includes(domainStatus) ? domainStatus : 'unset',
    suspensionReason: text(doc.suspensionReason),
    suspensionNote: text(doc.suspensionNote),
    suspendedAt: toIso(doc.suspendedAt),
    archivedAt: toIso(doc.archivedAt),
    govRevision: typeof doc.govRevision === 'number' ? doc.govRevision : 0,
    opsRevision: typeof doc.opsRevision === 'number' ? doc.opsRevision : 0,
    activeTheme: text(storefront.activeTheme),
    stripeOnboardingStatus: text(billing.stripeOnboardingStatus),
    stripeChargesEnabled: typeof billing.stripeChargesEnabled === 'boolean' ? billing.stripeChargesEnabled : null,
    updatedAt: toIso(doc.updatedAt) ?? new Date(0).toISOString(),
    history,
  };
}
