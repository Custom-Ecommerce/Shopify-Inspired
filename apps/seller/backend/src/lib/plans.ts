import type { PublicPlan } from '@markaz/contracts';
import { HttpError } from '@/lib/http';
import { SubscriptionPlanModel, assertCan } from '@/lib/services';
import type { AuthContext } from '@/lib/auth';

/**
 * Sprint 6 EP-14.US01.T07 (D-118): the plans a seller may see. Only the PUBLIC fields leave this module: key, name, price in whole
 * rupees, interval, limits, features, sort order. Never the Stripe price id, the revision, the archive data or the old tier. An archived
 * plan is not listed, and neither is an old plan (before Sprint 6) that has no key, price or limits.
 */

export const PUBLIC_PLAN_FIELDS = ['key', 'name', 'priceRs', 'interval', 'limits', 'features', 'sortOrder', 'isActive'] as const;
const SELECT = PUBLIC_PLAN_FIELDS.join(' ');

type Doc = Record<string, unknown>;

const limitOf = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** The public view of one stored plan, or null when it is not a complete current plan. */
export function toPublicPlan(doc: Doc): PublicPlan | null {
  const limits = doc.limits;
  if (typeof doc.key !== 'string' || doc.key === '' || typeof doc.name !== 'string') return null;
  if (typeof doc.priceRs !== 'number' || !Number.isInteger(doc.priceRs) || doc.priceRs < 0) return null;
  if (typeof limits !== 'object' || limits === null) return null;
  const l = limits as Doc;
  return {
    key: doc.key,
    name: doc.name,
    priceRs: doc.priceRs,
    interval: 'month',
    limits: {
      stores: limitOf(l.stores),
      products: limitOf(l.products),
      staffSeats: limitOf(l.staffSeats),
      apiKeys: limitOf(l.apiKeys),
      customDomain: l.customDomain === true,
      premiumThemes: l.premiumThemes === true,
    },
    features: Array.isArray(doc.features) ? doc.features.filter((feature): feature is string => typeof feature === 'string') : [],
    sortOrder: typeof doc.sortOrder === 'number' && Number.isInteger(doc.sortOrder) ? doc.sortOrder : 0,
  };
}

/** The active plans, cheapest sort order first. Any signed-in seller may read them; an admin session is refused. */
export async function listPublicPlans(ctx: AuthContext): Promise<PublicPlan[]> {
  if (ctx.actor !== 'seller') throw new HttpError(403, 'Only a seller can read the plans');
  assertCan(ctx.actor, 'read', 'subscriptionPlans', PUBLIC_PLAN_FIELDS);
  const rows = (await SubscriptionPlanModel.find({ isActive: { $ne: false }, key: { $type: 'string' } } as never)
    .select(SELECT)
    .sort({ sortOrder: 1, priceRs: 1, _id: 1 })
    .lean()) as unknown as Doc[];
  return rows.map(toPublicPlan).filter((plan): plan is PublicPlan => plan !== null);
}
