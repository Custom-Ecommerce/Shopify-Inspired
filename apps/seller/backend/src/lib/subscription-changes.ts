import type { DowngradeExceeds, OwnSubscriptionResponse } from '@markaz/contracts';
import { positiveWhole } from '@/lib/effective-limits';
import { DowngradeExceedsError, HttpError } from '@/lib/http';
import { FREE_PLAN_KEY, limitsOfPlan, loadEffectivePlan, productCountFilter, type PlanDoc } from '@/lib/plan';
import { Product, Store, Subscription, SubscriptionPlanModel, User } from '@/lib/services';
import { auditBestEffort, readOwnSubscription, revisionFilter, type SubscriptionRow } from '@/lib/subscription-payments';

/**
 * Sprint 6 EP-14 (S6-B4, D-118): a seller moves to a cheaper plan, or stops the subscription, from the period end. Nothing here changes the
 * plan that is in force: a downgrade stores pendingPlanKey and the expiry job applies it when the period ends; a cancel sets cancelAtPeriodEnd
 * and the plan stays until then. Both can be taken back until the period ends.
 */

const NO_SUBSCRIPTION = (): HttpError => new HttpError(409, 'You are on the Free plan: there is nothing to change.', 'NOTHING_TO_CHANGE');

interface PlanWithPrice extends PlanDoc {
  priceRs?: unknown;
  isActive?: boolean | null;
  archivedAt?: Date | string | null;
}

const LIMIT_LABELS: Record<DowngradeExceeds[number]['limit'], string> = { stores: 'stores', products: 'products in a store', staffSeats: 'staff seats', apiKeys: 'API keys' };

/** What the seller uses against a plan's limits: stores, the products of the busiest store (the limit is per store), staff seats and API keys (0 until Sprint 8). */
export async function usageOfSeller(sellerId: string): Promise<{ stores: number; products: number; staffSeats: number; apiKeys: number }> {
  const stores = (await Store.find({ owner: sellerId } as never).select('_id').lean()) as unknown as Array<{ _id: unknown }>;
  let busiest = 0;
  if (stores.length > 0) {
    const rows = (await Product.aggregate([
      { $match: { ...productCountFilter(''), store: { $in: stores.map((store) => store._id) } } },
      { $group: { _id: '$store', n: { $sum: 1 } } },
    ])) as Array<{ n: number }>;
    busiest = Math.max(0, ...rows.map((row) => row.n));
  }
  return { stores: stores.length, products: busiest, staffSeats: 0, apiKeys: 0 };
}

/** Pure: which limits of the target plan the use passes. null is unlimited. The seller's own store override wins over the plan's store limit. */
export function downgradeExceeds(
  limits: { stores: number | null; products: number | null; staffSeats: number | null; apiKeys: number | null },
  used: { stores: number; products: number; staffSeats: number; apiKeys: number },
  storeLimitOverride: number | null,
): DowngradeExceeds {
  const exceeds: DowngradeExceeds = [];
  const check = (limit: DowngradeExceeds[number]['limit'], allowed: number | null): void => {
    if (allowed !== null && used[limit] > allowed) exceeds.push({ limit, allowed, used: used[limit] });
  };
  check('stores', storeLimitOverride !== null ? storeLimitOverride : limits.stores);
  check('products', limits.products);
  check('staffSeats', limits.staffSeats);
  check('apiKeys', limits.apiKeys);
  return exceeds;
}

export function downgradeExceedsMessage(planName: string, exceeds: DowngradeExceeds): string {
  const parts = exceeds.map((entry) => LIMIT_LABELS[entry.limit] + ': the ' + planName + ' plan allows ' + entry.allowed + ' and you have ' + entry.used);
  return 'You cannot move to the ' + planName + ' plan yet. ' + parts.join('; ') + '. Remove the extra ones, then try again.';
}

/**
 * POST /api/subscription/downgrade { planKey | null }. A plan key asks for that cheaper plan from the period end; null takes a pending downgrade
 * back. Refused: 409 when there is no paid plan in force, 422 NOT_A_DOWNGRADE when the plan is not cheaper, 422 DOWNGRADE_EXCEEDS_LIMITS (with
 * what exceeds, per limit) when the use does not fit the target plan.
 */
export async function scheduleDowngrade(sellerId: string, planKey: string | null, now: Date = new Date()): Promise<OwnSubscriptionResponse> {
  const effective = await loadEffectivePlan(sellerId, now);
  const sub = (await Subscription.findOne({ seller: sellerId } as never).lean()) as unknown as SubscriptionRow | null;
  if (!sub || effective.key === FREE_PLAN_KEY) throw NO_SUBSCRIPTION();

  const setPending = async (value: string | null): Promise<void> => {
    if ((sub.pendingPlanKey ?? null) === value) return;
    const moved = await Subscription.findOneAndUpdate(
      { _id: sub._id, seller: sellerId, revision: revisionFilter(sub.revision) } as never,
      { $set: { pendingPlanKey: value }, $inc: { revision: 1 } } as never,
      { new: true },
    )
      .select('_id')
      .lean();
    if (!moved) throw new HttpError(409, 'Your subscription changed in the meantime. Reload and try again.', 'SUBSCRIPTION_CHANGED');
    await auditBestEffort(value === null ? 'subscription.downgrade_cancelled' : 'subscription.downgrade_scheduled', String(sub._id), 'seller:' + sellerId, {
      seller: sellerId,
      from: sub.planKey,
      to: value,
    });
  };

  if (planKey === null) {
    await setPending(null);
    return readOwnSubscription(sellerId);
  }
  if (planKey === sub.planKey) throw new HttpError(422, 'That is the plan you are on.', 'NOT_A_DOWNGRADE', 'planKey');

  const docs = (await SubscriptionPlanModel.find({ key: { $in: [planKey, sub.planKey] } } as never).select('key name priceRs limits isActive archivedAt').lean()) as unknown as PlanWithPrice[];
  const target = docs.find((doc) => doc.key === planKey);
  const current = docs.find((doc) => doc.key === sub.planKey);
  if (!target || target.isActive === false || target.archivedAt) throw new HttpError(404, 'That plan is not available.', 'PLAN_NOT_FOUND', 'planKey');
  const targetLimits = limitsOfPlan(target);
  const targetPrice = typeof target.priceRs === 'number' ? target.priceRs : 0;
  const currentPrice = typeof current?.priceRs === 'number' ? current.priceRs : null;
  if (!targetLimits || (currentPrice !== null && targetPrice >= currentPrice)) {
    throw new HttpError(422, 'That plan is not cheaper than your current one. To move up, use Upgrade.', 'NOT_A_DOWNGRADE', 'planKey');
  }

  const [used, user] = await Promise.all([
    usageOfSeller(sellerId),
    User.findById(sellerId).select('storeLimitOverride').lean() as unknown as Promise<{ storeLimitOverride?: unknown } | null>,
  ]);
  const exceeds = downgradeExceeds(targetLimits, used, positiveWhole(user?.storeLimitOverride));
  if (exceeds.length > 0) throw new DowngradeExceedsError(exceeds, downgradeExceedsMessage(target.name ?? planKey, exceeds));

  await setPending(planKey);
  return readOwnSubscription(sellerId);
}

/**
 * POST /api/subscription/cancel { cancelAtPeriodEnd }. true: the plan stays until the period ends, then the Free limits apply (no grace). false:
 * takes that back. Only a subscription that is paid and running can be cancelled (409 otherwise); setting the value it already has is a 200.
 */
export async function setCancelAtPeriodEnd(sellerId: string, cancelAtPeriodEnd: boolean, now: Date = new Date()): Promise<OwnSubscriptionResponse> {
  const effective = await loadEffectivePlan(sellerId, now);
  const sub = (await Subscription.findOne({ seller: sellerId } as never).lean()) as unknown as SubscriptionRow | null;
  if (!sub || effective.key === FREE_PLAN_KEY) throw NO_SUBSCRIPTION();
  if (sub.status !== 'active' || effective.status !== 'active') {
    throw new HttpError(409, 'Your plan is not running a paid period right now, so there is nothing to cancel. Renew it, or let it end.', 'SUBSCRIPTION_NOT_ACTIVE');
  }
  if ((sub.cancelAtPeriodEnd === true) !== cancelAtPeriodEnd) {
    const moved = await Subscription.findOneAndUpdate(
      { _id: sub._id, seller: sellerId, status: 'active', revision: revisionFilter(sub.revision) } as never,
      { $set: { cancelAtPeriodEnd }, $inc: { revision: 1 } } as never,
      { new: true },
    )
      .select('_id')
      .lean();
    if (!moved) throw new HttpError(409, 'Your subscription changed in the meantime. Reload and try again.', 'SUBSCRIPTION_CHANGED');
    await auditBestEffort(cancelAtPeriodEnd ? 'subscription.cancel_scheduled' : 'subscription.cancel_withdrawn', String(sub._id), 'seller:' + sellerId, {
      seller: sellerId,
      planKey: sub.planKey,
      periodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toISOString() : null,
    });
  }
  return readOwnSubscription(sellerId);
}
