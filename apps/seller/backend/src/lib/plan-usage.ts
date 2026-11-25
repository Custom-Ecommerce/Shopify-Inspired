import type { AdminSellerPlan, PlanUsage } from '@markaz/contracts';
import { positiveWhole } from '@/lib/effective-limits';
import {
  FREE_PLAN_KEY,
  countApiKeys,
  countApiKeysByStore,
  countProducts,
  countStaffSeats,
  countStaffSeatsByStore,
  countStores,
  loadEffectivePlan,
  productCountFilter,
  resolveEffectivePlan,
  type EffectivePlan,
  type PlanDoc,
  type SubscriptionLike,
} from '@/lib/plan';
import { readPlanSettings } from '@/lib/platform-settings';
import { Product, Store, Subscription, SubscriptionPlanModel, User } from '@/lib/services';

/**
 * Sprint 6 EP-14.US02 (D-118): the plan a seller is on and what is in use, as the seller's billing page and the admin's sellers page show it.
 * Products, staff seats and API keys are counted PER STORE (their limits are per store): the seller's page counts the store they are looking
 * at, the admin's page the store that uses the most of each.
 */

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** The store limit that applies: the seller's own override first (S6-B1), then the plan's. */
function storeLimitOf(plan: EffectivePlan, override: unknown): { limit: number | null; overridden: boolean } {
  const own = positiveWhole(override);
  return own !== null ? { limit: own, overridden: true } : { limit: plan.limits.stores, overridden: false };
}

export interface UsageInput {
  plan: EffectivePlan;
  storeLimitOverride: unknown;
  used: { stores: number; products: number; staffSeats: number; apiKeys: number };
}

/** Pure: the wire shape of plan usage. */
export function toPlanUsage(input: UsageInput): PlanUsage {
  const { plan } = input;
  const stores = storeLimitOf(plan, input.storeLimitOverride);
  return {
    plan: { key: plan.key, name: plan.name },
    status: plan.status,
    subscribedPlanKey: plan.subscribedPlanKey,
    limits: { ...plan.limits, stores: stores.limit },
    used: { stores: input.used.stores, products: input.used.products, staffSeats: input.used.staffSeats, apiKeys: input.used.apiKeys },
    periodEnd: iso(plan.periodEnd),
    graceUntil: iso(plan.graceUntil),
    daysLeft: plan.daysLeft,
    storeLimitOverridden: stores.overridden,
    fallbackLimits: plan.fallbackLimits,
  };
}

/** GET /api/stores/:id/plan-usage for one store of this seller. The route has already checked the seller owns the store. */
export async function buildPlanUsage(ownerId: string, storeId: string, now: Date = new Date()): Promise<PlanUsage> {
  const [plan, stores, products, staffSeats, apiKeys, user] = await Promise.all([
    loadEffectivePlan(ownerId, now),
    countStores(ownerId),
    countProducts(storeId),
    countStaffSeats(storeId),
    countApiKeys(storeId),
    User.findById(ownerId).select('storeLimitOverride').lean() as unknown as Promise<{ storeLimitOverride?: unknown } | null>,
  ]);
  return toPlanUsage({ plan, storeLimitOverride: user?.storeLimitOverride, used: { stores, products, staffSeats, apiKeys } });
}

/**
 * The sellers page: the plan, status and usage of up to 100 sellers in a few queries (not one set per seller). A seller that does not exist gets
 * the Free plan like any seller with no subscription. Products, staff seats, API keys: the store with the most of each, against the per-store limit.
 */
export async function buildSellerPlans(sellerIds: readonly string[], now: Date = new Date()): Promise<AdminSellerPlan[]> {
  if (sellerIds.length === 0) return [];
  const [subscriptions, stores, users, settings] = await Promise.all([
    Subscription.find({ seller: { $in: sellerIds } } as never).lean() as unknown as Promise<Array<SubscriptionLike & { seller: unknown }>>,
    Store.find({ owner: { $in: sellerIds } } as never).select('owner').lean() as unknown as Promise<Array<{ _id: unknown; owner: unknown }>>,
    User.find({ _id: { $in: sellerIds } } as never).select('storeLimitOverride').lean() as unknown as Promise<Array<{ _id: unknown; storeLimitOverride?: unknown }>>,
    readPlanSettings(),
  ]);

  const keys = [...new Set([FREE_PLAN_KEY, ...subscriptions.map((sub) => sub.planKey)])];
  const planDocs = (await SubscriptionPlanModel.find({ key: { $in: keys } } as never).select('key name limits').lean()) as unknown as PlanDoc[];
  const plans: Record<string, PlanDoc | undefined> = {};
  for (const doc of planDocs) if (typeof doc.key === 'string') plans[doc.key] = doc;

  const storeIds = stores.map((store) => String(store._id));
  const perStore = new Map<string, number>();
  let seatsPerStore = new Map<string, number>();
  let keysPerStore = new Map<string, number>();
  if (storeIds.length > 0) {
    const ids = stores.map((store) => store._id);
    [seatsPerStore, keysPerStore] = await Promise.all([countStaffSeatsByStore(ids), countApiKeysByStore(ids)]);
    const rows = (await Product.aggregate([
      { $match: { ...productCountFilter(''), store: { $in: stores.map((store) => store._id) } } },
      { $group: { _id: '$store', n: { $sum: 1 } } },
    ])) as Array<{ _id: unknown; n: number }>;
    for (const row of rows) perStore.set(String(row._id), row.n);
  }

  const ownedBy = new Map<string, string[]>();
  for (const store of stores) ownedBy.set(String(store.owner), [...(ownedBy.get(String(store.owner)) ?? []), String(store._id)]);
  const subOf = new Map(subscriptions.map((sub) => [String(sub.seller), sub]));
  const overrideOf = new Map(users.map((user) => [String(user._id), user.storeLimitOverride]));

  return sellerIds.map((sellerId) => {
    const plan = resolveEffectivePlan({ subscription: subOf.get(sellerId) ?? null, plans, now, graceDays: settings.graceDays });
    const owned = ownedBy.get(sellerId) ?? [];
    const most = (counts: Map<string, number>): number => Math.max(0, ...owned.map((id) => counts.get(id) ?? 0));
    const usage = toPlanUsage({
      plan,
      storeLimitOverride: overrideOf.get(sellerId),
      used: { stores: owned.length, products: most(perStore), staffSeats: most(seatsPerStore), apiKeys: most(keysPerStore) },
    });
    return { sellerId, plan: usage.plan, status: usage.status, periodEnd: usage.periodEnd, daysLeft: usage.daysLeft, limits: usage.limits, used: usage.used };
  });
}

