import mongoose from 'mongoose';
import type { EffectivePlanLimits, EffectivePlanStatus } from '@markaz/contracts';
import { PlanLimitError, type PlanLimitBody } from '@/lib/http';
import { readPlanSettings, DEFAULT_GRACE_DAYS } from '@/lib/platform-settings';
import { Product, Store, Subscription, SubscriptionPlanModel } from '@/lib/services';

/**
 * Sprint 6 EP-14.US02 (D-118): the plan a seller is EFFECTIVELY on, and what is in use against its limits.
 *
 * The rule, worked out on every read from the dates (nothing is written, so a job that has not run yet never gives free limits away and an
 * expired seller loses nothing but the ability to add):
 *
 *   trial      the plan's limits until trialEndsAt
 *   active     the plan's limits until currentPeriodEnd
 *   grace      the plan's limits until graceUntil. A subscription whose period has ended and whose graceUntil was never stored (the expiry
 *              job has not run) is in grace for graceDays (the platform setting, default 7) after currentPeriodEnd.
 *   cancelled  the plan's limits until currentPeriodEnd, then the Free plan's
 *   expired, no subscription, a date that has passed, a plan that no longer exists  ->  the Free plan's limits
 *
 * The Free plan comes from the plans collection (key "free"). If that document is missing the built-in Free limits apply (1 store, 10
 * products, 0 staff seats, 0 API keys, no custom domain) and the miss is logged once. The seller's storeLimitOverride (S6-B1) still wins for the
 * store limit: it is applied in lib/effective-limits.ts, not here.
 *
 * The resolver is pure and takes `now`. The loaders read the database; in a unit test with no connection they do nothing unless a loader was
 * installed (setPlanLoader), like the session guard.
 */

export const FREE_PLAN_KEY = 'free';

/** The Free limits when the Free plan document is missing (D-118). */
export const FALLBACK_FREE_LIMITS: Readonly<EffectivePlanLimits> = Object.freeze({
  stores: 1,
  products: 10,
  staffSeats: 0,
  apiKeys: 0,
  customDomain: false,
  premiumThemes: false,
});

const DAY_MS = 86_400_000;

export interface PlanDoc {
  key: string;
  name: string;
  limits?: Partial<Record<keyof EffectivePlanLimits, unknown>> | null;
}

export interface SubscriptionLike {
  planKey: string;
  status: string;
  currentPeriodEnd?: Date | string | null;
  graceUntil?: Date | string | null;
  trialEndsAt?: Date | string | null;
  cancelAtPeriodEnd?: boolean | null;
}

export interface EffectivePlan {
  /** The plan whose limits apply now. */
  key: string;
  name: string;
  status: EffectivePlanStatus;
  /** The plan of the subscription itself (it may be Growth while the limits are Free's). Null without a subscription. */
  subscribedPlanKey: string | null;
  limits: EffectivePlanLimits;
  /** The end of the paid period or of the trial; null when there is none. */
  periodEnd: Date | null;
  graceUntil: Date | null;
  /** Whole days left until periodEnd (until graceUntil while in grace), never below 0; null with no date. */
  daysLeft: number | null;
  /** True when the Free plan document is missing and FALLBACK_FREE_LIMITS are in use. */
  fallbackLimits: boolean;
}

const asDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const limitOf = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** The limits of a plan document. A plan with no limits (an old plan) is not a plan we can enforce: undefined. */
export function limitsOfPlan(plan: PlanDoc | null | undefined): EffectivePlanLimits | undefined {
  const l = plan?.limits;
  if (typeof l !== 'object' || l === null) return undefined;
  return {
    stores: limitOf(l.stores),
    products: limitOf(l.products),
    staffSeats: limitOf(l.staffSeats),
    apiKeys: limitOf(l.apiKeys),
    customDomain: l.customDomain === true,
    premiumThemes: l.premiumThemes === true,
  };
}

const daysUntil = (end: Date | null, now: Date): number | null => (end === null ? null : Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS)));

export interface ResolveInput {
  subscription: SubscriptionLike | null | undefined;
  /** The plan documents by key (at least the subscribed plan and "free"). */
  plans: Readonly<Record<string, PlanDoc | undefined>>;
  now: Date;
  /** The platform graceDays, used only for a subscription whose graceUntil was never stored. Default 7. */
  graceDays?: number;
}

/** Pure: the effective plan of one seller at `now`. */
export function resolveEffectivePlan(input: ResolveInput): EffectivePlan {
  const { subscription, plans, now } = input;
  const freeDoc = plans[FREE_PLAN_KEY];
  const freeLimits = limitsOfPlan(freeDoc);
  const free = (status: EffectivePlanStatus, subscribedPlanKey: string | null, periodEnd: Date | null, graceUntil: Date | null): EffectivePlan => ({
    key: FREE_PLAN_KEY,
    name: freeDoc?.name ?? 'Free',
    status,
    subscribedPlanKey,
    limits: freeLimits ?? { ...FALLBACK_FREE_LIMITS },
    periodEnd,
    graceUntil,
    daysLeft: null,
    fallbackLimits: freeLimits === undefined,
  });

  if (!subscription) return free('none', null, null, null);

  const planDoc = plans[subscription.planKey];
  const planLimits = limitsOfPlan(planDoc);
  const periodEnd = asDate(subscription.currentPeriodEnd);
  const trialEnds = asDate(subscription.trialEndsAt);
  const storedGrace = asDate(subscription.graceUntil);
  const graceDays = Number.isInteger(input.graceDays) && (input.graceDays as number) >= 0 ? (input.graceDays as number) : DEFAULT_GRACE_DAYS;
  const t = now.getTime();

  // The plan of the subscription, with its own limits, at a status and a date that is still in the future.
  const paid = (status: EffectivePlanStatus, end: Date | null, grace: Date | null): EffectivePlan => ({
    key: subscription.planKey,
    name: planDoc?.name ?? subscription.planKey,
    status,
    subscribedPlanKey: subscription.planKey,
    limits: planLimits as EffectivePlanLimits,
    periodEnd: end,
    graceUntil: grace,
    daysLeft: daysUntil(status === 'grace' ? grace : end, now),
    fallbackLimits: false,
  });

  // A subscription to a plan that is gone or has no limits cannot be enforced: Free applies (the seller keeps everything they have).
  const usable = planLimits !== undefined;

  switch (subscription.status) {
    case 'trial':
      if (usable && trialEnds !== null && t < trialEnds.getTime()) return paid('trial', trialEnds, null);
      return free('expired', subscription.planKey, trialEnds, null);
    case 'active':
    case 'grace': {
      // Paid and inside the period (an active subscription with no end date has none to pass).
      if (usable && subscription.status === 'active' && (periodEnd === null || t < periodEnd.getTime())) return paid('active', periodEnd, null);
      // A subscription set to end at the period end has no grace: the period over, the Free limits apply (it counts as cancelled).
      if (subscription.status === 'active' && subscription.cancelAtPeriodEnd === true) return free('cancelled', subscription.planKey, periodEnd, null);
      // Past the period: the plan's limits stay until the grace ends (stored by the expiry job, else the period end plus graceDays).
      const graceEnd = storedGrace ?? (periodEnd === null ? null : new Date(periodEnd.getTime() + graceDays * DAY_MS));
      if (usable && graceEnd !== null && t < graceEnd.getTime()) return paid('grace', periodEnd, graceEnd);
      return free('expired', subscription.planKey, periodEnd, graceEnd);
    }
    case 'cancelled':
      if (usable && periodEnd !== null && t < periodEnd.getTime()) return paid('cancelled', periodEnd, null);
      return free('cancelled', subscription.planKey, periodEnd, null);
    default:
      // 'expired' (and anything unknown): the Free limits.
      return free('expired', subscription.planKey, periodEnd, storedGrace);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Loading

let warnedFreeMissing = false;
/** Logs the missing Free plan once per process (the check runs on every limited write). Exported for the tests. */
export function warnFreePlanMissing(): void {
  if (warnedFreeMissing) return;
  warnedFreeMissing = true;
  console.error('[seller-backend] the Free plan document (key "free") is missing: the built-in Free limits apply. Run the bootstrap script.');
}
export function resetFreePlanWarning(): void {
  warnedFreeMissing = false;
}

export type PlanLoader = (ownerId: string, now: Date) => Promise<EffectivePlan>;
let loaderOverride: PlanLoader | null = null;

/** Test seam: replaces the database read of the effective plan (null puts the real one back). */
export function setPlanLoader(loader: PlanLoader | null): void {
  loaderOverride = loader;
}

/**
 * Whether plan limits can be checked now: a loader was installed, or the database connection is open. Under `next dev` and `next start`
 * a request has connected before its route gets here, so the check always runs; the unit tests of other routes stub the connection and
 * never open one, and would otherwise wait on a buffered command (the same seam as the session guard).
 */
export function canCheckPlans(): boolean {
  return loaderOverride !== null || mongoose.connection.readyState === 1;
}

/** Reads the seller's subscription, the plans it needs and the grace setting, and resolves. Throws on a database failure (the caller decides). */
async function loadFromDatabase(ownerId: string, now: Date): Promise<EffectivePlan> {
  const subscription = (await Subscription.findOne({ seller: ownerId }).lean()) as unknown as SubscriptionLike | null;
  const keys = [FREE_PLAN_KEY, ...(subscription && subscription.planKey !== FREE_PLAN_KEY ? [subscription.planKey] : [])];
  const docs = (await SubscriptionPlanModel.find({ key: { $in: keys } } as never)
    .select('key name limits')
    .lean()) as unknown as PlanDoc[];
  const plans: Record<string, PlanDoc | undefined> = {};
  for (const doc of docs) if (typeof doc.key === 'string') plans[doc.key] = doc;
  if (limitsOfPlan(plans[FREE_PLAN_KEY]) === undefined) warnFreePlanMissing();
  const needsGrace = subscription !== null && subscription.graceUntil == null && (subscription.status === 'active' || subscription.status === 'grace');
  const graceDays = needsGrace ? (await readPlanSettings()).graceDays : undefined;
  return resolveEffectivePlan({ subscription, plans, now, graceDays });
}

/** The effective plan of a seller (the owner id). */
export async function loadEffectivePlan(ownerId: string, now: Date = new Date()): Promise<EffectivePlan> {
  return (loaderOverride ?? loadFromDatabase)(ownerId, now);
}

/** The owner of a store, or null. */
export async function ownerOfStore(storeId: string): Promise<string | null> {
  const store = (await Store.findById(storeId).select('owner').lean()) as unknown as { owner?: unknown } | null;
  return store?.owner ? String(store.owner) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Usage

export type PlanLimitKind = 'products' | 'stores';

/** The products that count against a plan: the store's own, not in trash, and not the sample (demo) product. */
export function productCountFilter(storeId: string): Record<string, unknown> {
  return { store: storeId, deletedAt: null, isDemo: { $ne: true } };
}

export async function countProducts(storeId: string): Promise<number> {
  return Product.countDocuments(productCountFilter(storeId) as never);
}

/** All the stores a seller owns, whatever their status: the store limit counts them as provisionStore always has. */
export async function countStores(ownerId: string): Promise<number> {
  return Store.countDocuments({ owner: ownerId } as never);
}

// ---------------------------------------------------------------------------------------------------------------------
// assertWithinPlan

export { PlanLimitError, type PlanLimitBody } from '@/lib/http';

export interface UpgradeCandidate {
  key: string;
  name: string;
  priceRs: number | null;
  limit: number | null;
}

/** The words of the upgrade hint: the cheapest plan that allows more, or a plain line when there is none. */
export function upgradeHintFor(kind: PlanLimitKind, plan: string, used: number, candidates: readonly UpgradeCandidate[]): string {
  const noun = kind === 'products' ? 'products' : 'stores';
  const better = candidates
    .filter((candidate) => candidate.key !== plan && (candidate.limit === null || candidate.limit > used))
    .sort((a, b) => (a.priceRs ?? Number.MAX_SAFE_INTEGER) - (b.priceRs ?? Number.MAX_SAFE_INTEGER))[0];
  if (!better) return 'Your ' + plan + ' plan allows no more ' + noun + '. Contact support to raise the limit.';
  const room = better.limit === null ? 'unlimited ' + noun : 'up to ' + better.limit + ' ' + noun;
  const price = better.priceRs === null ? '' : better.priceRs === 0 ? '' : ' (Rs. ' + better.priceRs.toLocaleString('en-US') + ' / month)';
  return 'Upgrade to ' + better.name + price + ' for ' + room + '.';
}

export interface LimitCheck {
  kind: PlanLimitKind;
  /** The limit of the effective plan for this kind; null is unlimited. */
  limit: number | null;
  used: number;
  /** How many the write adds. 0 for something already counted (publish): never refused. Default 1. */
  adding?: number;
}

/** Pure: whether adding would pass the limit. Over the limit already keeps everything: only an add is refused. */
export function planLimitExceeded(check: LimitCheck): boolean {
  const adding = check.adding ?? 1;
  if (adding <= 0 || check.limit === null) return false;
  return check.used + adding > check.limit;
}

async function upgradeCandidates(kind: PlanLimitKind): Promise<UpgradeCandidate[]> {
  try {
    const docs = (await SubscriptionPlanModel.find({ isActive: { $ne: false }, key: { $type: 'string' } } as never)
      .select('key name priceRs limits')
      .lean()) as unknown as Array<PlanDoc & { priceRs?: unknown }>;
    return docs.flatMap((doc) => {
      const limits = limitsOfPlan(doc);
      if (!limits) return [];
      return [{ key: doc.key, name: doc.name, priceRs: typeof doc.priceRs === 'number' ? doc.priceRs : null, limit: limits[kind] }];
    });
  } catch {
    return [];
  }
}

export interface AssertWithinPlanInput {
  kind: PlanLimitKind;
  /** The seller who owns the store (the plan is the seller's). */
  ownerId: string;
  /** For products: the store whose products are counted. */
  storeId?: string;
  adding?: number;
  /** Override of the store limit that already won over the plan (the seller's storeLimitOverride): the number to use instead of the plan's. */
  limitOverride?: number | null;
  now?: Date;
}

/**
 * Refuses an add that passes the plan limit: 403 { code PLAN_LIMIT_REACHED, limit, used, plan, upgradeHint }.
 *
 * ORDER (the routes keep it): authenticate -> role -> assertCan -> ownership (403 foreign store, 404 foreign record) -> THIS -> the write.
 * It never runs before those, so a seller who may not touch a record hears 403/404, not a plan message. Edits and deletes never call it. A
 * seller already over a limit keeps everything and is only refused when they ADD.
 *
 * Where plans cannot be checked (no open connection in a unit test, no loader) it does nothing.
 */
export async function assertWithinPlan(input: AssertWithinPlanInput): Promise<void> {
  if (!canCheckPlans()) return;
  const adding = input.adding ?? 1;
  if (adding <= 0) return;
  const plan = await loadEffectivePlan(input.ownerId, input.now ?? new Date());
  const limit = input.kind === 'stores' && input.limitOverride !== undefined && input.limitOverride !== null ? input.limitOverride : plan.limits[input.kind];
  if (limit === null) return;
  const used = input.kind === 'products' ? await countProducts(input.storeId ?? '') : await countStores(input.ownerId);
  if (!planLimitExceeded({ kind: input.kind, limit, used, adding })) return;
  const upgradeHint = upgradeHintFor(input.kind, plan.key, used, await upgradeCandidates(input.kind));
  const noun = input.kind;
  throw new PlanLimitError(
    { code: 'PLAN_LIMIT_REACHED', limitKind: input.kind, limit, used, plan: plan.key, upgradeHint },
    'Your ' + plan.name + ' plan allows ' + limit + ' ' + noun + ' and you have ' + used + '. ' + upgradeHint,
  );
}

/** S7-B5 (D-118): whether the seller's effective plan includes a custom domain. True where plans cannot be checked (a unit test with no connection). */
export async function planAllowsCustomDomain(ownerId: string, now: Date = new Date()): Promise<boolean> {
  if (!canCheckPlans()) return true;
  return (await loadEffectivePlan(ownerId, now)).limits.customDomain === true;
}

/**
 * Refuses a custom domain on a plan without it: 403 PLAN_LIMIT_REACHED with limitKind customDomain (limit 0). Same order rule as
 * assertWithinPlan: it runs after the ownership checks. Disconnecting never calls it: a seller who lost the feature can always leave.
 */
export async function assertCustomDomainAllowed(ownerId: string, now: Date = new Date()): Promise<void> {
  if (!canCheckPlans()) return;
  const plan = await loadEffectivePlan(ownerId, now);
  if (plan.limits.customDomain === true) return;
  const upgradeHint = 'A custom domain is part of the Growth plan. Upgrade to connect your own domain.';
  throw new PlanLimitError(
    { code: 'PLAN_LIMIT_REACHED', limitKind: 'customDomain', limit: 0, used: 0, plan: plan.key, upgradeHint },
    'Your ' + plan.name + ' plan does not include a custom domain. ' + upgradeHint,
  );
}

/** S7-B7 (D-118): whether the seller's effective plan includes premium themes. True where plans cannot be checked (a unit test with no connection). */
export async function planAllowsPremiumThemes(ownerId: string, now: Date = new Date()): Promise<boolean> {
  if (!canCheckPlans()) return true;
  return (await loadEffectivePlan(ownerId, now)).limits.premiumThemes === true;
}

/** The store's owner, then assertWithinPlan for products. A store with no owner is not limited here (it cannot be a seller's). */
export async function assertProductSlot(storeId: string, adding: number = 1): Promise<void> {
  if (!canCheckPlans() || adding <= 0) return;
  const ownerId = await ownerOfStore(storeId);
  if (ownerId === null) return;
  await assertWithinPlan({ kind: 'products', ownerId, storeId, adding });
}

export interface ProductSlots {
  /** How many more products this store may add; null is unlimited (or plans cannot be checked). */
  remaining: number | null;
  /** The message of a refused row (built on demand: it names the plan and the upgrade). */
  refusal: () => Promise<string>;
}

/**
 * For the CSV import: how many NEW products the file may create. Each Handle that would create one takes a slot; updates take none. Over the
 * limit already means no slots (remaining 0), never a negative number, and the rows that update still run.
 */
export async function productSlotsFor(storeId: string): Promise<ProductSlots> {
  const unlimited: ProductSlots = { remaining: null, refusal: async () => '' };
  if (!canCheckPlans()) return unlimited;
  const ownerId = await ownerOfStore(storeId);
  if (ownerId === null) return unlimited;
  const plan = await loadEffectivePlan(ownerId);
  const limit = plan.limits.products;
  if (limit === null) return unlimited;
  const used = await countProducts(storeId);
  return {
    remaining: Math.max(0, limit - used),
    refusal: async () => {
      const hint = upgradeHintFor('products', plan.key, used, await upgradeCandidates('products'));
      return 'PLAN_LIMIT_REACHED: your ' + plan.name + ' plan allows ' + limit + ' products and you have ' + used + '. ' + hint;
    },
  };
}
