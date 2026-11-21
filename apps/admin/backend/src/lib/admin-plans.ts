import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
  MAX_SEARCH_LENGTH,
  escapeRegex,
  readInteger,
  toIso,
  type Doc,
  type Issue,
} from '@/lib/admin-stores';

/** Pure helpers for the admin subscription plan list: query parsing, the Mongo filter, and the wire shape. No I/O. */

export const PLAN_TIERS = ['basic', 'pro', 'premium'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export interface PlanListQuery {
  page: number;
  limit: number;
  q: string | null;
  tier: PlanTier | null;
}

export type ParsedPlanQuery = { ok: true; query: PlanListQuery } | { ok: false; issues: Issue[] };

export function parsePlanQuery(params: URLSearchParams): ParsedPlanQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const rawQ = (params.get('q') ?? '').trim();
  if (rawQ.length > MAX_SEARCH_LENGTH) issues.push({ path: 'q', message: 'must be at most ' + MAX_SEARCH_LENGTH + ' characters' });
  const rawTier = params.get('tier') ?? '';
  let tier: PlanTier | null = null;
  if (rawTier !== '') {
    if ((PLAN_TIERS as readonly string[]).includes(rawTier)) tier = rawTier as PlanTier;
    else issues.push({ path: 'tier', message: 'must be one of ' + PLAN_TIERS.join(', ') });
  }
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, q: rawQ === '' ? null : rawQ, tier } };
}

/** The search text is escaped, so it is matched literally against the plan name, never as a pattern. */
export function buildPlanFilter(query: PlanListQuery): Doc {
  const filter: Doc = {};
  if (query.tier !== null) filter.tier = query.tier;
  if (query.q !== null) filter.name = { $regex: escapeRegex(query.q), $options: 'i' };
  return filter;
}

const limitOf = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** The limits of a plan as the console reads them; an old plan has none (null), and null inside is "unlimited". */
function toLimits(value: unknown) {
  if (typeof value !== 'object' || value === null) return null;
  const limits = value as Doc;
  return {
    stores: limitOf(limits.stores),
    products: limitOf(limits.products),
    staffSeats: limitOf(limits.staffSeats),
    apiKeys: limitOf(limits.apiKeys),
    customDomain: limits.customDomain === true,
    premiumThemes: limits.premiumThemes === true,
  };
}

/**
 * The plan as the console lists it. A plan from before Sprint 6 has a name, a Stripe price and a tier only: its key, price and limits are
 * null. A plan made now has no tier, and no Stripe price unless one was given. The revision is the compare-and-set counter of the writes.
 */
export function toPlanRow(doc: Doc) {
  return {
    id: String(doc._id),
    name: typeof doc.name === 'string' ? doc.name : '',
    tier: (PLAN_TIERS as readonly unknown[]).includes(doc.tier) ? (doc.tier as PlanTier) : null,
    stripePriceId: typeof doc.stripePriceId === 'string' && doc.stripePriceId !== '' ? doc.stripePriceId : null,
    key: typeof doc.key === 'string' && doc.key !== '' ? doc.key : null,
    priceRs: typeof doc.priceRs === 'number' && Number.isInteger(doc.priceRs) && doc.priceRs >= 0 ? doc.priceRs : null,
    interval: 'month' as const,
    limits: toLimits(doc.limits),
    features: Array.isArray(doc.features) ? doc.features.filter((feature): feature is string => typeof feature === 'string') : [],
    isActive: doc.isActive !== false,
    sortOrder: typeof doc.sortOrder === 'number' && Number.isInteger(doc.sortOrder) ? doc.sortOrder : 0,
    revision: planRevisionOf(doc),
    archivedAt: toIso(doc.archivedAt),
    createdAt: toIso(doc.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(doc.updatedAt) ?? toIso(doc.createdAt) ?? new Date(0).toISOString(),
  };
}

/** Counts per tier, in the order of PLAN_TIERS. A missing or invalid count is zero. */
export function toTierCounts(counts: readonly unknown[]): Record<PlanTier, number> {
  const at = (index: number): number => {
    const value = counts[index];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  };
  return { basic: at(0), pro: at(1), premium: at(2) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-14 (D-118): plan writes. Pure helpers: the documents and updates the routes apply.

/** The fields the policy lets an admin write on an update (ADMIN_PLAN_WRITABLE_FIELDS), and create (ADMIN_PLAN_CREATABLE_FIELDS). */
export const PLAN_WRITE_FIELDS = ['name', 'priceRs', 'limits', 'features', 'sortOrder', 'stripePriceId', 'isActive', 'archivedAt'] as const;
export const PLAN_CREATE_FIELDS = ['key', 'name', 'priceRs', 'interval', 'limits', 'features', 'sortOrder', 'stripePriceId', 'isActive'] as const;

/**
 * The plans nothing may archive: Free is the plan every seller falls back to when a subscription expires (D-118), so a console without it
 * would leave sellers without limits.
 */
export const PROTECTED_PLAN_KEYS: readonly string[] = ['free'];

/** The stored revision; a plan that has never been written has none: 0. */
export function planRevisionOf(doc: Doc): number {
  const revision = doc.revision;
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

/** The compare-and-set filter: the write applies only if the revision is still the one that was read. A plan with no revision matches 0. */
export function planRevisionFilter(id: string, revision: number): Doc {
  return { _id: id, revision: revision === 0 ? { $in: [0, null] } : revision };
}

export interface PlanCreateInput {
  key: string;
  name: string;
  priceRs: number;
  limits: Doc;
  features: string[];
  sortOrder: number;
  stripePriceId?: string | null;
}

/** The document a create stores. Active, revision 0, not archived; the Stripe price only when one was given. */
export function buildPlanDocument(input: PlanCreateInput): Doc {
  const doc: Doc = {
    key: input.key,
    name: input.name,
    priceRs: input.priceRs,
    interval: 'month',
    limits: input.limits,
    features: input.features,
    sortOrder: input.sortOrder,
    isActive: true,
    archivedAt: null,
    revision: 0,
  };
  if (typeof input.stripePriceId === 'string') doc.stripePriceId = input.stripePriceId;
  return doc;
}

export interface PlanChanges {
  name?: string;
  priceRs?: number;
  limits?: Doc;
  features?: string[];
  sortOrder?: number;
  /** null removes the Stripe price. */
  stripePriceId?: string | null;
  isActive?: boolean;
}

/** The fields an update touches, in a fixed order. */
export function changedPlanFields(changes: PlanChanges): Array<keyof PlanChanges> {
  return (['name', 'priceRs', 'limits', 'features', 'sortOrder', 'stripePriceId', 'isActive'] as const).filter((field) => changes[field] !== undefined);
}

/**
 * The update of a PATCH: the fields sent, a cleared Stripe price removed from the document, bringing a plan back (isActive true) clearing
 * archivedAt, and the revision advanced by one.
 */
export function buildPlanUpdate(changes: PlanChanges): Doc {
  const set: Doc = {};
  const unset: Doc = {};
  for (const field of changedPlanFields(changes)) {
    const value = changes[field];
    if (field === 'stripePriceId' && value === null) unset.stripePriceId = 1;
    else set[field] = value;
  }
  if (changes.isActive === true) set.archivedAt = null;
  const update: Doc = { $inc: { revision: 1 } };
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}

/** The update of an archive: inactive, when it happened, and the revision advanced. Nothing is deleted. */
export function buildArchiveUpdate(now: Date): Doc {
  return { $set: { isActive: false, archivedAt: now }, $inc: { revision: 1 } };
}

/** What an audit entry keeps of a plan: the fields an operator can change, nothing else. */
export function planSnapshot(row: ReturnType<typeof toPlanRow>) {
  return {
    key: row.key,
    name: row.name,
    priceRs: row.priceRs,
    limits: row.limits,
    features: row.features,
    sortOrder: row.sortOrder,
    stripePriceId: row.stripePriceId,
    isActive: row.isActive,
  };
}

/** A Mongo duplicate-key error (code 11000). */
export function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}
