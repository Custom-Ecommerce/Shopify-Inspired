import { DEFAULT_LIMIT, MAX_LIMIT, MAX_PAGE, isObjectId, readInteger, toIso, type Doc, type Issue } from '@/lib/admin-stores';

/**
 * Pure helpers for the admin commission RATE changes (Sprint 4 EP-05.US02, D-089): the input checks, the wire shapes and the
 * history query. No I/O. A rate is a percentage from 0 to 100 with at most one decimal.
 */

export const RATE_MIN = 0;
export const RATE_MAX = 100;
export const RATE_REASON_MIN = 3;
export const RATE_REASON_MAX = 500;
export const RATE_SCOPES = ['store', 'platform'] as const;

export interface RateChangeInput {
  /** null: the store goes back to the platform default (DELETE). */
  rate: number | null;
  reason: string;
}

export type ParsedRateChange = { ok: true; data: RateChangeInput } | { ok: false; issues: Issue[] };

/** True for a number with at most one decimal place. */
export function hasOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

export function parseRate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < RATE_MIN || value > RATE_MAX || !hasOneDecimal(value)) return null;
  return Math.round(value * 10) / 10;
}

/** A body { rate, reason } (a PUT) or { reason } (a DELETE, which sets rate null). Unknown fields are refused. */
export function parseRateChange(input: unknown, mode: 'set' | 'clear'): ParsedRateChange {
  const issues: Issue[] = [];
  const body = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Doc) : null;
  if (body === null) return { ok: false, issues: [{ path: 'body', message: 'must be a JSON object' }] };
  const allowed = mode === 'set' ? ['rate', 'reason'] : ['reason'];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) issues.push({ path: key, message: 'is not allowed here' });

  let rate: number | null = null;
  if (mode === 'set') {
    rate = parseRate(body.rate);
    if (rate === null) issues.push({ path: 'rate', message: 'must be a number from ' + RATE_MIN + ' to ' + RATE_MAX + ' with at most one decimal' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < RATE_REASON_MIN || reason.length > RATE_REASON_MAX) {
    issues.push({ path: 'reason', message: 'is required (' + RATE_REASON_MIN + ' to ' + RATE_REASON_MAX + ' characters)' });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: { rate, reason } };
}

/** One store's rate as the console reads it. The effective rate follows the same rule as the seller backend. */
export function toStoreRateView(doc: Doc, defaultRate: number) {
  const custom = doc.commissionMode === 'custom' && typeof doc.commissionRate === 'number' && Number.isFinite(doc.commissionRate);
  return {
    storeId: String(doc._id),
    name: typeof doc.name === 'string' ? doc.name : '',
    mode: custom ? ('custom' as const) : ('inherit' as const),
    customRate: custom ? (doc.commissionRate as number) : null,
    defaultRate,
    effectiveRate: custom ? (doc.commissionRate as number) : defaultRate,
  };
}

export interface HistoryQuery {
  page: number;
  limit: number;
  storeId: string | null;
  scope: (typeof RATE_SCOPES)[number] | null;
}

export type ParsedHistoryQuery = { ok: true; query: HistoryQuery } | { ok: false; issues: Issue[] };

export function parseHistoryQuery(params: URLSearchParams): ParsedHistoryQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const storeId = (params.get('storeId') ?? '').trim();
  if (storeId !== '' && !isObjectId(storeId)) issues.push({ path: 'storeId', message: 'must be a store id' });
  const rawScope = (params.get('scope') ?? '').trim();
  if (rawScope !== '' && !(RATE_SCOPES as readonly string[]).includes(rawScope)) issues.push({ path: 'scope', message: 'must be store or platform' });
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, storeId: storeId === '' ? null : storeId, scope: rawScope === '' ? null : (rawScope as HistoryQuery['scope']) } };
}

export function buildHistoryFilter(query: HistoryQuery): Doc {
  const filter: Doc = {};
  if (query.storeId !== null) filter.store = query.storeId;
  if (query.scope !== null) filter.scope = query.scope;
  return filter;
}

export function toHistoryRow(doc: Doc, storeNames: Map<string, string>) {
  const storeId = doc.store === null || doc.store === undefined ? null : String(doc.store);
  return {
    id: String(doc._id),
    scope: doc.scope === 'platform' ? ('platform' as const) : ('store' as const),
    store: storeId === null ? null : { id: storeId, name: storeNames.get(storeId) ?? '(unknown store)' },
    actor: typeof doc.actor === 'string' ? doc.actor : '',
    oldMode: typeof doc.oldMode === 'string' ? doc.oldMode : null,
    oldRate: typeof doc.oldRate === 'number' ? doc.oldRate : null,
    newMode: typeof doc.newMode === 'string' ? doc.newMode : null,
    newRate: typeof doc.newRate === 'number' ? doc.newRate : null,
    reason: typeof doc.reason === 'string' ? doc.reason : '',
    createdAt: toIso(doc.createdAt),
  };
}
