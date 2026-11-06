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

export function toPlanRow(doc: Doc) {
  return {
    id: String(doc._id),
    name: typeof doc.name === 'string' ? doc.name : '',
    tier: doc.tier as PlanTier,
    stripePriceId: typeof doc.stripePriceId === 'string' ? doc.stripePriceId : '',
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
