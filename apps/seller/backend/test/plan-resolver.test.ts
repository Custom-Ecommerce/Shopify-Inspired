import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { PlatformSettingsModel, Product, Store, Subscription, SubscriptionPlanModel } from '@/lib/services';
import { handleRouteError } from '@/lib/http';
import {
  FALLBACK_FREE_LIMITS,
  PlanLimitError,
  assertProductSlot,
  assertWithinPlan,
  canCheckPlans,
  limitsOfPlan,
  loadEffectivePlan,
  planLimitExceeded,
  productCountFilter,
  resetFreePlanWarning,
  resolveEffectivePlan,
  setPlanLoader,
  upgradeHintFor,
  seatRefusalMessage,
  type EffectivePlan,
  type PlanDoc,
  type SubscriptionLike,
} from '../src/lib/plan';

// Sprint 6 EP-14.US02 (D-118): the effective-plan resolver and assertWithinPlan. The resolver is pure and takes `now`; the loaders are tested with
// the models stubbed in memory. No database.

const NOW = new Date('2026-11-20T10:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);

const FREE: PlanDoc = { key: 'free', name: 'Free', limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false } };
const GROWTH: PlanDoc = { key: 'growth', name: 'Growth', limits: { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true } };
const plans = { free: FREE, growth: GROWTH };

const resolve = (subscription: SubscriptionLike | null, extra: { plans?: Record<string, PlanDoc | undefined>; graceDays?: number; now?: Date } = {}): EffectivePlan =>
  resolveEffectivePlan({ subscription, plans: extra.plans ?? plans, now: extra.now ?? NOW, graceDays: extra.graceDays });

const sub = (status: string, extra: Partial<SubscriptionLike> = {}): SubscriptionLike => ({ planKey: 'growth', status, ...extra });

const GROWTH_LIMITS = { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true };
const FREE_LIMITS = { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false };

// ------------------------------------------------------------------------------------------------------------- the resolver

test('no subscription: the Free plan, status none, nothing subscribed', () => {
  const plan = resolve(null);
  assert.deepEqual([plan.key, plan.name, plan.status, plan.subscribedPlanKey, plan.fallbackLimits], ['free', 'Free', 'none', null, false]);
  assert.deepEqual(plan.limits, FREE_LIMITS);
  assert.deepEqual([plan.periodEnd, plan.daysLeft], [null, null]);
});

test('active, inside the period: the plan\'s limits, the period end and the days left', () => {
  const plan = resolve(sub('active', { currentPeriodEnd: at(10) }));
  assert.deepEqual([plan.key, plan.status, plan.subscribedPlanKey, plan.daysLeft], ['growth', 'active', 'growth', 10]);
  assert.deepEqual(plan.limits, GROWTH_LIMITS);
  assert.equal(plan.periodEnd?.getTime(), at(10).getTime());
  assert.equal(resolve(sub('active', { currentPeriodEnd: new Date(NOW.getTime() + DAY / 2) })).daysLeft, 1, 'a part of a day counts as a day');
});

test('active with no end date has none to pass', () => {
  const plan = resolve(sub('active'));
  assert.deepEqual([plan.key, plan.status, plan.periodEnd, plan.daysLeft], ['growth', 'active', null, null]);
});

test('active past its period: grace with the plan\'s limits until graceUntil (stored)', () => {
  const plan = resolve(sub('active', { currentPeriodEnd: at(-1), graceUntil: at(6) }));
  assert.deepEqual([plan.key, plan.status, plan.daysLeft], ['growth', 'grace', 6]);
  assert.deepEqual(plan.limits, GROWTH_LIMITS);
  assert.equal(plan.graceUntil?.getTime(), at(6).getTime());
});

test('active past its period and the job has not run (no graceUntil): grace for graceDays, default 7, then the Free limits', () => {
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(-3) })).status, 'grace');
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(-6.9) })).status, 'grace');
  const lapsed = resolve(sub('active', { currentPeriodEnd: at(-8) }));
  assert.deepEqual([lapsed.key, lapsed.status, lapsed.subscribedPlanKey], ['free', 'expired', 'growth']);
  assert.deepEqual(lapsed.limits, FREE_LIMITS);
});

test('graceDays comes from the setting: 3 days ends grace sooner, 30 days later', () => {
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(-4) }), { graceDays: 3 }).status, 'expired');
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(-4) }), { graceDays: 30 }).status, 'grace');
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(-1) }), { graceDays: 0 }).status, 'expired');
});

test('the boundary is exact: at the period end the period is over, one millisecond before it is not', () => {
  assert.equal(resolve(sub('active', { currentPeriodEnd: new Date(NOW.getTime() + 1) })).status, 'active');
  assert.equal(resolve(sub('active', { currentPeriodEnd: NOW, graceUntil: at(7) })).status, 'grace');
  assert.equal(resolve(sub('grace', { currentPeriodEnd: at(-7), graceUntil: NOW })).status, 'expired');
  assert.equal(resolve(sub('grace', { currentPeriodEnd: at(-7), graceUntil: new Date(NOW.getTime() + 1) })).status, 'grace');
});

test('grace status: the plan\'s limits until graceUntil, then expired; without a stored end it is the period end plus graceDays', () => {
  const inGrace = resolve(sub('grace', { currentPeriodEnd: at(-2), graceUntil: at(5) }));
  assert.deepEqual([inGrace.key, inGrace.status, inGrace.daysLeft], ['growth', 'grace', 5]);
  const over = resolve(sub('grace', { currentPeriodEnd: at(-9), graceUntil: at(-2) }));
  assert.deepEqual([over.key, over.status], ['free', 'expired']);
  assert.equal(resolve(sub('grace', { currentPeriodEnd: at(-2) })).status, 'grace');
  assert.equal(resolve(sub('grace', { currentPeriodEnd: at(-9) })).status, 'expired');
  assert.equal(resolve(sub('grace')).status, 'expired', 'grace with no date at all cannot be enforced');
});

test('trial: the plan\'s limits until trialEndsAt; after it, or with no date, the Free limits (no grace for a trial)', () => {
  const running = resolve(sub('trial', { trialEndsAt: at(4) }));
  assert.deepEqual([running.key, running.status, running.daysLeft], ['growth', 'trial', 4]);
  assert.deepEqual(running.limits, GROWTH_LIMITS);
  for (const trialEndsAt of [at(-1), NOW, null, undefined]) {
    const ended = resolve(sub('trial', { trialEndsAt }));
    assert.deepEqual([ended.key, ended.status], ['free', 'expired'], String(trialEndsAt));
  }
});

test('cancelled: the plan\'s limits until the period ends, then the Free limits and the status stays cancelled', () => {
  const until = resolve(sub('cancelled', { currentPeriodEnd: at(12) }));
  assert.deepEqual([until.key, until.status, until.daysLeft], ['growth', 'cancelled', 12]);
  const after = resolve(sub('cancelled', { currentPeriodEnd: at(-1) }));
  assert.deepEqual([after.key, after.status, after.subscribedPlanKey], ['free', 'cancelled', 'growth']);
  assert.deepEqual(after.limits, FREE_LIMITS);
  assert.equal(resolve(sub('cancelled')).key, 'free', 'cancelled with no end date');
});

test('an active subscription set to cancel at the period end has no grace: the period over, the Free limits', () => {
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(5), cancelAtPeriodEnd: true })).key, 'growth');
  const over = resolve(sub('active', { currentPeriodEnd: at(-1), cancelAtPeriodEnd: true, graceUntil: at(6) }));
  assert.deepEqual([over.key, over.status], ['free', 'cancelled']);
});

test('expired and an unknown status: the Free limits, the subscribed plan remembered', () => {
  for (const status of ['expired', 'paused', '']) {
    const plan = resolve(sub(status, { currentPeriodEnd: at(30) }));
    assert.deepEqual([plan.key, plan.status, plan.subscribedPlanKey], ['free', 'expired', 'growth'], status);
    assert.deepEqual(plan.limits, FREE_LIMITS, status);
  }
});

test('a subscription to a plan that no longer exists, or has no limits, cannot be enforced: Free applies', () => {
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(10) }), { plans: { free: FREE } }).key, 'free');
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(10) }), { plans: { free: FREE, growth: { key: 'growth', name: 'Growth' } } }).key, 'free');
  assert.equal(resolve(sub('active', { currentPeriodEnd: at(10) }), { plans: { free: FREE, growth: { key: 'growth', name: 'Growth', limits: null } } }).key, 'free');
});

test('a Free subscription is a plain Free plan with its own dates', () => {
  const plan = resolve({ planKey: 'free', status: 'active', currentPeriodEnd: at(30) }, { plans: { free: FREE } });
  assert.deepEqual([plan.key, plan.status], ['free', 'active']);
  assert.deepEqual(plan.limits, FREE_LIMITS);
});

test('the Free plan document missing: the built-in Free limits (1 store, 10 products, 0 staff, 0 keys, no domain), flagged', () => {
  assert.deepEqual({ ...FALLBACK_FREE_LIMITS }, FREE_LIMITS);
  for (const subscription of [null, sub('expired'), sub('trial', { trialEndsAt: at(-1) })]) {
    const plan = resolve(subscription, { plans: { growth: GROWTH } });
    assert.deepEqual([plan.key, plan.name, plan.fallbackLimits], ['free', 'Free', true]);
    assert.deepEqual(plan.limits, FREE_LIMITS);
  }
  const paid = resolve(sub('active', { currentPeriodEnd: at(10) }), { plans: { growth: GROWTH } });
  assert.deepEqual([paid.key, paid.fallbackLimits], ['growth', false], 'a paying seller is not touched by a missing Free plan');
});

test('a plan\'s limits: junk becomes unlimited or false, an object that is not one is not a plan', () => {
  assert.deepEqual(limitsOfPlan({ key: 'x', name: 'X', limits: { stores: -1, products: 2.5, staffSeats: '3', apiKeys: 4, customDomain: 'yes', premiumThemes: 1 } }), {
    stores: null,
    products: null,
    staffSeats: null,
    apiKeys: 4,
    customDomain: false,
    premiumThemes: false,
  });
  assert.equal(limitsOfPlan({ key: 'x', name: 'X' }), undefined);
  assert.equal(limitsOfPlan(null), undefined);
  assert.equal(limitsOfPlan(undefined), undefined);
});

test('resolving never mutates what it is given, and nothing is written (it is pure)', () => {
  const subscription = sub('active', { currentPeriodEnd: at(-3) });
  const copy = JSON.stringify(subscription);
  resolve(subscription);
  assert.equal(JSON.stringify(subscription), copy);
  assert.equal(subscription.status, 'active', 'the stored status is the job\'s to move, not a read\'s');
});

// ------------------------------------------------------------------------------------------------------- the limit and the hint

test('planLimitExceeded: an add past the limit, never an add within it, never an unlimited one, never something already counted', () => {
  assert.equal(planLimitExceeded({ kind: 'products', limit: 10, used: 10 }), true);
  assert.equal(planLimitExceeded({ kind: 'products', limit: 10, used: 9 }), false);
  assert.equal(planLimitExceeded({ kind: 'products', limit: 10, used: 8, adding: 3 }), true);
  assert.equal(planLimitExceeded({ kind: 'products', limit: null, used: 9999 }), false);
  assert.equal(planLimitExceeded({ kind: 'products', limit: 10, used: 10, adding: 0 }), false, 'publish adds nothing');
  assert.equal(planLimitExceeded({ kind: 'products', limit: 10, used: 25, adding: 0 }), false, 'a seller over the limit keeps what they have');
  assert.equal(planLimitExceeded({ kind: 'products', limit: 0, used: 0 }), true);
});

test('the upgrade hint names the cheapest plan that allows more, or says to contact support', () => {
  const growth = { key: 'growth', name: 'Growth', priceRs: 2500, limit: null };
  const big = { key: 'scale', name: 'Scale', priceRs: 5000, limit: 1000 };
  const free = { key: 'free', name: 'Free', priceRs: 0, limit: 10 };
  assert.equal(upgradeHintFor('products', 'free', 10, [free, big, growth]), 'Upgrade to Growth (Rs. 2,500 / month) for unlimited products.');
  assert.equal(upgradeHintFor('stores', 'free', 1, [free, { key: 'growth', name: 'Growth', priceRs: 2500, limit: 3 }]), 'Upgrade to Growth (Rs. 2,500 / month) for up to 3 stores.');
  assert.match(upgradeHintFor('products', 'growth', 50, [{ ...growth, limit: 50 }, free]), /allows no more products\. Contact support/);
  assert.match(upgradeHintFor('products', 'free', 10, []), /Contact support/);
});

// ------------------------------------------------------------------------------------------- assertWithinPlan, models stubbed

const SELLER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const ProductModel = Product as any;
const StoreModel = Store as any;
const PlanModel = SubscriptionPlanModel as any;
const SubModel = Subscription as any;
const SettingsModel = PlatformSettingsModel as any;

let productsInStore: number;
let storesOfSeller: number;
let productFilters: any[];
let restore: () => void = () => {};

const planOf = (products: number | null, stores: number | null = 3, key = 'free'): EffectivePlan => ({
  key,
  name: key === 'free' ? 'Free' : 'Growth',
  status: 'none',
  subscribedPlanKey: null,
  limits: { stores, products, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false },
  periodEnd: null,
  graceUntil: null,
  daysLeft: null,
  fallbackLimits: false,
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  productsInStore = 4;
  storesOfSeller = 1;
  productFilters = [];
  resetFreePlanWarning();
  const saved = {
    pCount: ProductModel.countDocuments,
    sCount: StoreModel.countDocuments,
    sFindById: StoreModel.findById,
    planFind: PlanModel.find,
    subFindOne: SubModel.findOne,
    settings: SettingsModel.findOne,
  };
  ProductModel.countDocuments = async (filter: any) => (productFilters.push(filter), productsInStore);
  StoreModel.countDocuments = async () => storesOfSeller;
  StoreModel.findById = () => chain(() => ({ owner: SELLER }));
  PlanModel.find = () => chain(() => [FREE, GROWTH]);
  restore = () => {
    ProductModel.countDocuments = saved.pCount;
    StoreModel.countDocuments = saved.sCount;
    StoreModel.findById = saved.sFindById;
    PlanModel.find = saved.planFind;
    SubModel.findOne = saved.subFindOne;
    SettingsModel.findOne = saved.settings;
    setPlanLoader(null);
  };
});

afterEach(() => restore());

test('assertWithinPlan: over the product limit is a 403 with the code, the limit, the use, the plan and the hint', async () => {
  setPlanLoader(async () => planOf(4));
  await assert.rejects(
    () => assertWithinPlan({ kind: 'products', ownerId: SELLER, storeId: STORE }),
    (err: unknown) => {
      assert.ok(err instanceof PlanLimitError);
      assert.equal(err.status, 403);
      assert.deepEqual([err.body.code, err.body.limitKind, err.body.limit, err.body.used, err.body.plan], ['PLAN_LIMIT_REACHED', 'products', 4, 4, 'free']);
      assert.equal(typeof err.body.upgradeHint, 'string');
      assert.match(err.message, /Free plan allows 4 products and you have 4/);
      return true;
    },
  );
});

test('assertWithinPlan: within the limit, unlimited, adding 0 and a plan that cannot be checked all pass without a count', async () => {
  setPlanLoader(async () => planOf(5));
  await assertWithinPlan({ kind: 'products', ownerId: SELLER, storeId: STORE });
  setPlanLoader(async () => planOf(null, null, 'growth'));
  productFilters = [];
  await assertWithinPlan({ kind: 'products', ownerId: SELLER, storeId: STORE });
  assert.equal(productFilters.length, 0, 'an unlimited plan counts nothing');
  setPlanLoader(async () => planOf(1));
  await assertWithinPlan({ kind: 'products', ownerId: SELLER, storeId: STORE, adding: 0 });
  setPlanLoader(null);
  assert.equal(canCheckPlans(), false, 'no loader and no open connection: plans are not checked');
  await assertWithinPlan({ kind: 'products', ownerId: SELLER, storeId: STORE });
});

test('assertWithinPlan counts the store\'s own non-trashed, non-sample products and nothing else', async () => {
  setPlanLoader(async () => planOf(4));
  await assert.rejects(() => assertWithinPlan({ kind: 'products', ownerId: SELLER, storeId: STORE }));
  assert.deepEqual(productFilters[0], { store: STORE, deletedAt: null, isDemo: { $ne: true } });
  assert.deepEqual(productCountFilter(STORE), productFilters[0]);
});

test('assertWithinPlan for stores counts what the seller owns, and a seller-set limit takes the place of the plan\'s', async () => {
  setPlanLoader(async () => planOf(10, 1));
  await assert.rejects(() => assertWithinPlan({ kind: 'stores', ownerId: SELLER }), (err: unknown) => err instanceof PlanLimitError && err.body.limit === 1 && err.body.used === 1 && err.body.limitKind === 'stores');
  await assertWithinPlan({ kind: 'stores', ownerId: SELLER, limitOverride: 5 });
  storesOfSeller = 5;
  await assert.rejects(() => assertWithinPlan({ kind: 'stores', ownerId: SELLER, limitOverride: 5 }), (err: unknown) => err instanceof PlanLimitError && err.body.limit === 5);
});

test('assertProductSlot looks the owner up from the store, and a store with no owner is not limited here', async () => {
  setPlanLoader(async (owner) => (owner === SELLER ? planOf(4) : planOf(null)));
  await assert.rejects(() => assertProductSlot(STORE), (err: unknown) => err instanceof PlanLimitError);
  await assertProductSlot(STORE, 0);
  StoreModel.findById = () => chain(() => ({}));
  await assertProductSlot(STORE);
});

test('a refusal is rendered as 403 with the body fields at the top and the message in errors', async () => {
  const error = new PlanLimitError(
    { code: 'PLAN_LIMIT_REACHED', limitKind: 'products', limit: 10, used: 10, plan: 'free', upgradeHint: 'Upgrade to Growth.' },
    'Your Free plan allows 10 products and you have 10.',
  );
  const res = handleRouteError(error);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), {
    errors: [{ message: 'Your Free plan allows 10 products and you have 10.' }],
    code: 'PLAN_LIMIT_REACHED',
    limitKind: 'products',
    limit: 10,
    used: 10,
    plan: 'free',
    upgradeHint: 'Upgrade to Growth.',
  });
});

// ------------------------------------------------------------------------------------------------------------- the loader

test('loadEffectivePlan reads the subscription, the plan documents and, when it needs it, graceDays from the setting, and writes nothing', async () => {
  let settingsReads = 0;
  SubModel.findOne = () => chain(() => ({ planKey: 'growth', status: 'active', currentPeriodEnd: at(-2) }));
  SettingsModel.findOne = () => {
    settingsReads += 1;
    return chain(() => ({ graceDays: 3 }));
  };
  const inGrace = await loadEffectivePlan(SELLER, NOW);
  assert.deepEqual([inGrace.key, inGrace.status], ['growth', 'grace'], 'two days past the period is inside a 3 day grace');
  assert.equal(settingsReads, 1);
  SubModel.findOne = () => chain(() => ({ planKey: 'growth', status: 'active', currentPeriodEnd: at(-4) }));
  const lapsed = await loadEffectivePlan(SELLER, NOW);
  assert.deepEqual([lapsed.key, lapsed.status], ['free', 'expired'], 'four days past is outside it');
});

test('loadEffectivePlan: a stored graceUntil means graceDays is not read at all', async () => {
  let settingsReads = 0;
  SubModel.findOne = () => chain(() => ({ planKey: 'growth', status: 'grace', currentPeriodEnd: at(-2), graceUntil: at(4) }));
  SettingsModel.findOne = () => {
    settingsReads += 1;
    return chain(() => ({ graceDays: 3 }));
  };
  const plan = await loadEffectivePlan(SELLER, NOW);
  assert.deepEqual([plan.key, plan.status], ['growth', 'grace']);
  assert.equal(settingsReads, 0);
});

test('loadEffectivePlan: no subscription is Free; a missing Free plan logs once, however many loads, and uses the built-in limits', async () => {
  SubModel.findOne = () => chain(() => null);
  PlanModel.find = () => chain(() => [GROWTH]);
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const first = await loadEffectivePlan(SELLER, NOW);
    await loadEffectivePlan(SELLER, NOW);
    await loadEffectivePlan(SELLER, NOW);
    assert.deepEqual([first.key, first.status, first.fallbackLimits], ['free', 'none', true]);
    assert.deepEqual(first.limits, FREE_LIMITS);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1, 'logged once');
  assert.match(String(errors[0]![0]), /Free plan document .*missing/);
});

test('loadEffectivePlan asks for the subscribed plan and Free together, and for Free alone when the seller has no subscription', async () => {
  const filters: any[] = [];
  PlanModel.find = (filter: any) => (filters.push(filter), chain(() => [FREE, GROWTH]));
  SubModel.findOne = () => chain(() => ({ planKey: 'growth', status: 'active', currentPeriodEnd: at(9) }));
  await loadEffectivePlan(SELLER, NOW);
  SubModel.findOne = () => chain(() => null);
  await loadEffectivePlan(SELLER, NOW);
  assert.deepEqual(filters[0].key.$in, ['free', 'growth']);
  assert.deepEqual(filters[1].key.$in, ['free']);
});

test('the connection check: plans are checked once a connection is open or a loader is installed', () => {
  const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  try {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
    assert.equal(canCheckPlans(), true);
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    assert.equal(canCheckPlans(), false);
    setPlanLoader(async () => planOf(1));
    assert.equal(canCheckPlans(), true);
  } finally {
    if (descriptor) Object.defineProperty(mongoose.connection, 'readyState', descriptor);
    else delete (mongoose.connection as any).readyState;
  }
});

test('SB-F1: the seat refusal names the plan once, whatever the numbers; the hint uses the plan name, never its key', () => {
  assert.equal(seatRefusalMessage('Growth', 3, 3), 'Your Growth plan allows 3 staff seats and all 3 are in use. Upgrade your plan to invite more.');
  assert.equal(seatRefusalMessage('Growth', 1, 1), 'Your Growth plan allows 1 staff seat and it is in use. Upgrade your plan to invite more.');
  assert.equal(seatRefusalMessage('Growth', 3, 5), 'Your Growth plan allows 3 staff seats and you have 5 in use. Upgrade your plan to invite more.');
  assert.equal(seatRefusalMessage('Free', 0, 0), 'Your Free plan has no staff seats. Upgrade your plan to invite your team.');
  const top = [{ key: 'growth', name: 'Growth', priceRs: 2500, limit: 3 }];
  assert.equal(upgradeHintFor('staffSeats', 'growth', 3, top), 'Contact support to raise the limit.');
  assert.equal(upgradeHintFor('products', 'growth', 3, top), 'Your Growth plan allows no more products. Contact support to raise the limit.');
});
