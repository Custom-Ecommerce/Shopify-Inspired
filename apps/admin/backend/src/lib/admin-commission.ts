import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
  MAX_SEARCH_LENGTH,
  buildStoreFilter,
  escapeRegex,
  idOf,
  isObjectId,
  readInteger,
  toIso,
  type Doc,
  type Issue,
  type StoreStatus,
} from '@/lib/admin-stores';

/**
 * Pure helpers for the admin commission views: the ledger and the per-store rates. Query parsing, the Mongo filters,
 * and the wire shapes. No I/O. Amounts are minor units and rates are percentages (ID-18).
 */

export const LEDGER_STATUSES = ['pending', 'settled'] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];
export const PAYMENT_METHODS = ['card', 'cod'] as const;
export const RATE_MODES = ['inherit', 'custom'] as const;
export type RateMode = (typeof RATE_MODES)[number];

/** The platform settings live in the shared globals collection under this type. */
export const SETTINGS_GLOBAL_TYPE = 'platformSettings';

/** A search by store text resolves to at most this many stores, so one query cannot fan out without bound. */
export const STORE_MATCH_LIMIT = 100;

/**
 * The ledger fields the admin policy may read (ADMIN_LEDGER_READABLE_FIELDS). The route selects exactly these, so the
 * order id, seller order id, payment intent, and application fee never leave the database.
 */
export const LEDGER_FIELDS = [
  'store',
  'orderAmount',
  'commissionRate',
  'commissionAmount',
  'status',
  'paymentMethod',
  'settlementDate',
  'settlementRef',
  'createdAt',
] as const;
export const LEDGER_SELECT = LEDGER_FIELDS.join(' ');

const EPOCH = new Date(0).toISOString();

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/* Ledger. */

export interface LedgerListQuery {
  page: number;
  limit: number;
  q: string | null;
  status: LedgerStatus | null;
}

export type ParsedLedgerQuery = { ok: true; query: LedgerListQuery } | { ok: false; issues: Issue[] };

export function parseLedgerQuery(params: URLSearchParams): ParsedLedgerQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const rawQ = (params.get('q') ?? '').trim();
  if (rawQ.length > MAX_SEARCH_LENGTH) issues.push({ path: 'q', message: 'must be at most ' + MAX_SEARCH_LENGTH + ' characters' });
  const rawStatus = params.get('status') ?? '';
  let status: LedgerStatus | null = null;
  if (rawStatus !== '') {
    if ((LEDGER_STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as LedgerStatus;
    else issues.push({ path: 'status', message: 'must be one of ' + LEDGER_STATUSES.join(', ') });
  }
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, q: rawQ === '' ? null : rawQ, status } };
}

/**
 * The Mongo filter for the ledger. The search text is matched literally, never as a pattern: against the settlement
 * reference, and against the stores it resolves to (storeIds, found by the route with the store filter). A store id
 * also matches directly, so a row whose store is gone can still be found. With a status and a search, both must hold.
 */
export function buildLedgerFilter(query: LedgerListQuery, storeIds: readonly string[]): Doc {
  const clauses: Doc[] = [];
  if (query.status !== null) clauses.push({ status: query.status });
  if (query.q !== null) {
    const or: Doc[] = [{ settlementRef: { $regex: escapeRegex(query.q), $options: 'i' } }];
    if (storeIds.length > 0) or.push({ store: { $in: [...storeIds] } });
    if (isObjectId(query.q)) or.push({ store: query.q });
    clauses.push({ $or: or });
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

/** The store filter that resolves a ledger search to stores: name, slug, domain, or id, matched literally. */
export function buildStoreMatchFilter(q: string): Doc {
  return buildStoreFilter({ page: 1, limit: 1, q, status: null });
}

export function toLedgerRow(doc: Doc, storeNames: Map<string, string>) {
  const storeId = idOf(doc.store);
  const method = doc.paymentMethod;
  const ref = typeof doc.settlementRef === 'string' && doc.settlementRef !== '' ? doc.settlementRef : null;
  return {
    id: String(doc._id),
    store: storeId === null ? null : { id: storeId, name: storeNames.get(storeId) ?? '(unknown store)' },
    orderAmount: num(doc.orderAmount),
    commissionRate: Math.max(0, num(doc.commissionRate)),
    commissionAmount: num(doc.commissionAmount),
    status: doc.status === 'settled' ? ('settled' as const) : doc.status === 'refunded' ? ('refunded' as const) : ('pending' as const),
    paymentMethod: method === 'card' || method === 'cod' ? method : null,
    settlementDate: toIso(doc.settlementDate),
    settlementRef: ref,
    createdAt: toIso(doc.createdAt) ?? EPOCH,
  };
}

export interface LedgerBucket {
  count: number;
  orderAmount: number;
  commissionAmount: number;
}

/** The totals by status from the grouped aggregate. A status with no rows is zero; any other group is ignored. */
export function toLedgerTotals(groups: unknown): { pending: LedgerBucket; settled: LedgerBucket; refunded: LedgerBucket } {
  const totals = {
    pending: { count: 0, orderAmount: 0, commissionAmount: 0 },
    settled: { count: 0, orderAmount: 0, commissionAmount: 0 },
    refunded: { count: 0, orderAmount: 0, commissionAmount: 0 },
  };
  if (!Array.isArray(groups)) return totals;
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue;
    const row = group as Doc;
    const key = row._id;
    if (key !== 'pending' && key !== 'settled' && key !== 'refunded') continue;
    totals[key] = {
      count: Math.max(0, Math.floor(num(row.count))),
      orderAmount: num(row.orderAmount),
      commissionAmount: num(row.commissionAmount),
    };
  }
  return totals;
}

/* Rates. */

export interface RatesListQuery {
  page: number;
  limit: number;
  q: string | null;
  mode: RateMode | null;
}

export type ParsedRatesQuery = { ok: true; query: RatesListQuery } | { ok: false; issues: Issue[] };

export function parseRatesQuery(params: URLSearchParams): ParsedRatesQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const rawQ = (params.get('q') ?? '').trim();
  if (rawQ.length > MAX_SEARCH_LENGTH) issues.push({ path: 'q', message: 'must be at most ' + MAX_SEARCH_LENGTH + ' characters' });
  const rawMode = params.get('mode') ?? '';
  let mode: RateMode | null = null;
  if (rawMode !== '') {
    if ((RATE_MODES as readonly string[]).includes(rawMode)) mode = rawMode as RateMode;
    else issues.push({ path: 'mode', message: 'must be one of ' + RATE_MODES.join(', ') });
  }
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, q: rawQ === '' ? null : rawQ, mode } };
}

/**
 * Stores by name, slug, domain, or id, optionally by rate source. A store with no mode uses its own rate, the same
 * rule the billing package applies, so the custom filter is every store that does not inherit.
 */
export function buildRatesFilter(query: RatesListQuery): Doc {
  const filter = buildStoreFilter({ page: query.page, limit: query.limit, q: query.q, status: null });
  if (query.mode === 'inherit') filter.commissionMode = 'inherit';
  if (query.mode === 'custom') filter.commissionMode = { $ne: 'inherit' };
  return filter;
}

/**
 * The billing package's effective-rate rule (resolveEffectiveCommissionRate): an inherit store uses the platform
 * default; a custom store, or one with no mode, uses its own rate. Null when the rate that applies is unusable.
 */
export function resolveEffectiveRate(mode: unknown, ownRate: unknown, defaultRate: number | null): number | null {
  if (mode === 'inherit' && isRate(defaultRate)) return defaultRate;
  return isRate(ownRate) ? ownRate : null;
}

export function toDefaultRate(settings: Doc | null | undefined): number | null {
  return settings && isRate(settings.defaultCommissionRate) ? settings.defaultCommissionRate : null;
}

export function toRateRow(doc: Doc, defaultRate: number | null) {
  return {
    id: String(doc._id),
    name: typeof doc.name === 'string' ? doc.name : '',
    status: doc.status as StoreStatus,
    commissionMode: doc.commissionMode === 'inherit' ? ('inherit' as const) : ('custom' as const),
    commissionRate: isRate(doc.commissionRate) ? doc.commissionRate : 0,
    effectiveRate: resolveEffectiveRate(doc.commissionMode, doc.commissionRate, defaultRate),
  };
}
