import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { PlatformSettingsModel, Product, Store, Subscription, SubscriptionPlanModel, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setSessionUserLoader } from '@/lib/session-user';
import { planUsageSchema, adminSellerPlansResponseSchema } from '../../../../packages/contracts/src/subscription';
import { resolveEffectivePlan, setPlanLoader, type PlanDoc } from '../src/lib/plan';
import { buildSellerPlans, toPlanUsage } from '../src/lib/plan-usage';

// Sprint 6 EP-14.US02 (D-118): GET /api/stores/:id/plan-usage and the signed call behind the admin's sellers page. The models are stubbed in
// memory; the real resolver runs through setPlanLoader. No database.

const AUTH_SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
const A = '65a000000000000000000001';
const B = '65a000000000000000000002';
const C = '65a000000000000000000004';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_A2 = '65a000000000000000000013';
const STORE_B = '65a000000000000000000012';
const NOW = new Date('2026-11-20T10:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);

const FREE: PlanDoc = { key: 'free', name: 'Free', limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false } };
const GROWTH: PlanDoc = { key: 'growth', name: 'Growth', limits: { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true } };

const ProductModel = Product as any;
const StoreModel = Store as any;
const UserModel = User as any;
const SubModel = Subscription as any;
const PlanModel = SubscriptionPlanModel as any;
const SettingsModel = PlatformSettingsModel as any;

let subs: Array<Record<string, any>>;
let storeRows: Array<{ _id: string; owner: string }>;
let productRows: Array<{ store: string; deleted?: boolean; demo?: boolean }>;
let userRows: Record<string, Record<string, any>>;
let writes: number;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let usageGET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let sellersPOST: (r: NextRequest) => Promise<Response>;
let restore: () => void = () => {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: A, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: B, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, AUTH_SECRET, SELLER_AUDIENCE);
  usageGET = (await import('../src/app/api/stores/[id]/plan-usage/route')).GET;
  sellersPOST = (await import('../src/app/api/internal/plans/sellers/route')).POST;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, limit: () => q, lean: async () => value() };
  return q;
};

const counted = (store: string): number => productRows.filter((p) => p.store === store && !p.deleted && !p.demo).length;

beforeEach(() => {
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  subs = [];
  storeRows = [
    { _id: STORE_A, owner: A },
    { _id: STORE_A2, owner: A },
    { _id: STORE_B, owner: B },
  ];
  productRows = [
    ...Array.from({ length: 7 }, () => ({ store: STORE_A })),
    { store: STORE_A, deleted: true },
    { store: STORE_A, demo: true },
    ...Array.from({ length: 2 }, () => ({ store: STORE_A2 })),
    ...Array.from({ length: 30 }, () => ({ store: STORE_B })),
  ];
  userRows = { [A]: {}, [B]: {}, [C]: {} };
  writes = 0;
  setSessionUserLoader(async (id) => ({ role: id === ADMIN ? 'admin' : 'seller', accountStatus: 'active', tokenVersion: 0, emailVerified: true, emailVerifiedAt: new Date() }) as any);
  const saved = {
    connect: (mongoose as any).connect,
    storeExists: StoreModel.exists,
    storeFindOne: StoreModel.findOne,
    storeCount: StoreModel.countDocuments,
    storeFind: StoreModel.find,
    productCount: ProductModel.countDocuments,
    productAggregate: ProductModel.aggregate,
    userFindById: UserModel.findById,
    userFind: UserModel.find,
    subFind: SubModel.find,
    subUpdate: SubModel.findOneAndUpdate,
    subUpdateOne: SubModel.updateOne,
    subCreate: SubModel.create,
    planFind: PlanModel.find,
    settings: SettingsModel.findOne,
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.exists = async (filter: any) => (storeRows.some((s) => s._id === String(filter._id) && s.owner === String(filter.owner)) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => chain(() => storeRows.find((s) => s._id === String(filter._id) && s.owner === String(filter.owner)) ?? null);
  StoreModel.countDocuments = async (filter: any) => storeRows.filter((s) => s.owner === String(filter.owner)).length;
  StoreModel.find = (filter: any) => chain(() => storeRows.filter((s) => filter.owner.$in.includes(s.owner)));
  ProductModel.countDocuments = async (filter: any) => counted(String(filter.store));
  ProductModel.aggregate = async (pipeline: any[]) => {
    const ids: string[] = pipeline[0].$match.store.$in.map(String);
    return ids.map((id) => ({ _id: id, n: counted(id) })).filter((row) => row.n > 0);
  };
  UserModel.findById = (id: unknown) => chain(() => userRows[String(id)] ?? null);
  UserModel.find = (filter: any) => chain(() => filter._id.$in.map((id: string) => ({ _id: id, ...(userRows[id] ?? {}) })));
  SubModel.find = (filter: any) => chain(() => subs.filter((s) => filter.seller.$in.includes(String(s.seller))));
  const forbidden = () => {
    writes += 1;
    throw new Error('plan usage is read only');
  };
  SubModel.findOneAndUpdate = forbidden;
  SubModel.updateOne = forbidden;
  SubModel.create = forbidden;
  PlanModel.find = () => chain(() => [FREE, GROWTH]);
  SettingsModel.findOne = () => chain(() => ({ graceDays: 7 }));
  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.exists = saved.storeExists;
    StoreModel.findOne = saved.storeFindOne;
    StoreModel.countDocuments = saved.storeCount;
    StoreModel.find = saved.storeFind;
    ProductModel.countDocuments = saved.productCount;
    ProductModel.aggregate = saved.productAggregate;
    UserModel.findById = saved.userFindById;
    UserModel.find = saved.userFind;
    SubModel.find = saved.subFind;
    SubModel.findOneAndUpdate = saved.subUpdate;
    SubModel.updateOne = saved.subUpdateOne;
    SubModel.create = saved.subCreate;
    PlanModel.find = saved.planFind;
    SettingsModel.findOne = saved.settings;
    setPlanLoader(null);
    setSessionUserLoader(null);
    delete process.env.MODERATION_API_SECRET;
  };
});

afterEach(() => restore());

/** The loader the route uses, backed by the REAL resolver and the in-memory subscription of each seller. */
function realResolverFor(): void {
  setPlanLoader(async (ownerId, now) => {
    const subscription = subs.find((s) => String(s.seller) === ownerId) ?? null;
    return resolveEffectivePlan({ subscription, plans: { free: FREE, growth: GROWTH }, now: NOW ?? now, graceDays: 7 });
  });
}

const get = (id: string, token: string | null, storeHeader?: string): Promise<Response> =>
  usageGET(
    new NextRequest('http://seller.test/api/stores/' + id + '/plan-usage', {
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(storeHeader ? { 'x-store-id': storeHeader } : {}) },
    }),
    { params: Promise.resolve({ id }) },
  );

interface Usage {
  plan: { key: string; name: string };
  status: string;
  subscribedPlanKey: string | null;
  limits: Record<string, unknown>;
  used: { stores: number; products: number; staffSeats: number; apiKeys: number };
  periodEnd: string | null;
  graceUntil: string | null;
  daysLeft: number | null;
  storeLimitOverridden: boolean;
  fallbackLimits: boolean;
}

// -------------------------------------------------------------------------------------------------------------------- the seller

test('a seller with no subscription is on Free: its limits, status none, and what is used in THIS store (trash and sample excluded)', async () => {
  realResolverFor();
  const res = await get(STORE_A, tokenA);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as Usage;
  assert.equal(planUsageSchema.safeParse(body).success, true);
  assert.deepEqual([body.plan.key, body.plan.name, body.status, body.subscribedPlanKey], ['free', 'Free', 'none', null]);
  assert.deepEqual(body.limits, { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false });
  assert.deepEqual(body.used, { stores: 2, products: 7, staffSeats: 0, apiKeys: 0 });
  assert.deepEqual([body.periodEnd, body.daysLeft, body.storeLimitOverridden, body.fallbackLimits], [null, null, false, false]);
});

test('usage is per store: the same seller\'s other store has its own product count', async () => {
  realResolverFor();
  assert.equal(((await (await get(STORE_A2, tokenA)).json()) as Usage).used.products, 2);
  assert.equal(((await (await get(STORE_A, tokenA)).json()) as Usage).used.products, 7);
});

test('an active Growth seller: the plan\'s limits (null is unlimited), the period end and the days left', async () => {
  subs = [{ seller: A, planKey: 'growth', status: 'active', currentPeriodEnd: at(12) }];
  realResolverFor();
  const body = (await (await get(STORE_A, tokenA)).json()) as Usage;
  assert.deepEqual([body.plan.key, body.status, body.subscribedPlanKey, body.daysLeft], ['growth', 'active', 'growth', 12]);
  assert.deepEqual(body.limits, { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true });
  assert.equal(body.periodEnd, at(12).toISOString());
});

test('trial and grace show their own status, date and days', async () => {
  subs = [{ seller: A, planKey: 'growth', status: 'trial', trialEndsAt: at(5) }];
  realResolverFor();
  let body = (await (await get(STORE_A, tokenA)).json()) as Usage;
  assert.deepEqual([body.status, body.plan.key, body.daysLeft, body.periodEnd], ['trial', 'growth', 5, at(5).toISOString()]);
  subs = [{ seller: A, planKey: 'growth', status: 'grace', currentPeriodEnd: at(-2), graceUntil: at(4) }];
  body = (await (await get(STORE_A, tokenA)).json()) as Usage;
  assert.deepEqual([body.status, body.plan.key, body.daysLeft, body.graceUntil], ['grace', 'growth', 4, at(4).toISOString()]);
});

test('expired falls back to the Free limits without deleting anything: the seller still has all their stores and products', async () => {
  subs = [{ seller: A, planKey: 'growth', status: 'expired', currentPeriodEnd: at(-40) }];
  realResolverFor();
  const body = (await (await get(STORE_A, tokenA)).json()) as Usage;
  assert.deepEqual([body.status, body.plan.key, body.subscribedPlanKey], ['expired', 'free', 'growth']);
  assert.deepEqual(body.limits.products, 10);
  assert.deepEqual(body.used, { stores: 2, products: 7, staffSeats: 0, apiKeys: 0 }, 'over the Free store limit (2 of 1), and everything is still counted and kept');
  assert.equal(storeRows.length, 3);
  assert.equal(writes, 0);
});

test('an admin\'s store limit for this seller wins over the plan and is flagged', async () => {
  subs = [{ seller: A, planKey: 'growth', status: 'active', currentPeriodEnd: at(10) }];
  userRows[A] = { storeLimitOverride: 8 };
  realResolverFor();
  const body = (await (await get(STORE_A, tokenA)).json()) as Usage;
  assert.deepEqual([body.limits.stores, body.storeLimitOverridden], [8, true]);
  assert.equal(body.limits.products, null, 'the other limits stay the plan\'s');
  userRows[A] = { storeLimitOverride: 1 };
  assert.equal(((await (await get(STORE_A, tokenA)).json()) as Usage).limits.stores, 1, 'a lower override holds a Growth seller');
});

test('the Free plan missing: the built-in limits, flagged', async () => {
  setPlanLoader(async () => resolveEffectivePlan({ subscription: null, plans: {}, now: NOW }));
  const body = (await (await get(STORE_A, tokenA)).json()) as Usage;
  assert.deepEqual([body.fallbackLimits, body.limits.stores, body.limits.products], [true, 1, 10]);
});

test('reading plan usage never writes, whatever the dates say (a lapsed subscription stays as stored)', async () => {
  subs = [{ seller: A, planKey: 'growth', status: 'active', currentPeriodEnd: at(-30) }];
  realResolverFor();
  const body = (await (await get(STORE_A, tokenA)).json()) as Usage;
  assert.equal(body.status, 'expired');
  assert.equal(subs[0]!.status, 'active', 'the job moves the stored status, a read never does');
  assert.equal(writes, 0);
});

// ------------------------------------------------------------------------------------------------------------- the order and isolation

test('the order: 401 without a session, 403 for an admin session, 403 for a store that is not this seller\'s, 404 for an unknown or malformed id', async () => {
  realResolverFor();
  assert.equal((await get(STORE_A, null)).status, 401);
  assert.equal((await get(STORE_A, tokenAdmin)).status, 403);
  assert.equal((await get(STORE_B, tokenA)).status, 403, 'another seller\'s store');
  assert.equal((await get('65a0000000000000000000ff', tokenA)).status, 403, 'an id that is no store of this seller');
  assert.equal((await get('not-an-id', tokenA)).status, 404);
  assert.equal(writes, 0);
});

test('a store named in the header that is not the path\'s is refused, never mixed', async () => {
  realResolverFor();
  assert.equal((await get(STORE_A, tokenA, STORE_B)).status, 403);
});

test('Seller B is on their own plan and their usage never counts for Seller A', async () => {
  subs = [{ seller: A, planKey: 'growth', status: 'active', currentPeriodEnd: at(10) }];
  realResolverFor();
  const a = (await (await get(STORE_A, tokenA)).json()) as Usage;
  const b = (await (await get(STORE_B, tokenB)).json()) as Usage;
  assert.deepEqual([a.plan.key, a.used.products, a.used.stores], ['growth', 7, 2]);
  assert.deepEqual([b.plan.key, b.used.products, b.used.stores, b.status], ['free', 30, 1, 'none']);
});

// ------------------------------------------------------------------------------------------------------ the admin's signed call

const signed = (body: unknown, secret = MOD_SECRET): NextRequest => {
  const path = '/api/internal/plans/sellers';
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://seller.test' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...internalRequestHeaders(secret, { method: 'POST', path, adminId: ADMIN, body: raw }) },
    body: raw,
  });
};

test('the sellers page call answers each seller\'s plan, status and usage in one go', async () => {
  subs = [
    { seller: A, planKey: 'growth', status: 'active', currentPeriodEnd: at(9) },
    { seller: C, planKey: 'growth', status: 'expired', currentPeriodEnd: at(-60) },
  ];
  userRows[B] = { storeLimitOverride: 5 };
  const res = await sellersPOST(signed({ sellerIds: [A, B, C] }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { plans: Array<Record<string, any>> };
  assert.equal(adminSellerPlansResponseSchema.safeParse(body).success, true);
  const byId = Object.fromEntries(body.plans.map((p) => [p.sellerId, p]));
  assert.deepEqual([byId[A].plan.key, byId[A].status, byId[A].daysLeft, byId[A].used], ['growth', 'active', 9, { stores: 2, products: 7, staffSeats: 0, apiKeys: 0 }]);
  assert.deepEqual([byId[B].plan.key, byId[B].status, byId[B].limits.stores, byId[B].used.products], ['free', 'none', 5, 30]);
  assert.deepEqual([byId[C].plan.key, byId[C].status, byId[C].used], ['free', 'expired', { stores: 0, products: 0, staffSeats: 0, apiKeys: 0 }]);
  assert.deepEqual(body.plans.map((p) => p.sellerId), [A, B, C], 'in the order asked');
  assert.equal(writes, 0);
});

test('buildSellerPlans: products are the store with the most, and a seller nobody knows is on Free', async () => {
  const plans = await buildSellerPlans([A, '65a0000000000000000000ee'], NOW);
  assert.equal(plans[0]!.used.products, 7, 'the larger of the two stores (7 and 2)');
  assert.deepEqual([plans[1]!.plan.key, plans[1]!.status, plans[1]!.used.stores], ['free', 'none', 0]);
  assert.deepEqual(await buildSellerPlans([], NOW), []);
});

test('the signed call is only for the admin backend: unsigned, wrongly signed and a seller session are 401; a bad body is 422', async () => {
  const path = '/api/internal/plans/sellers';
  const raw = JSON.stringify({ sellerIds: [A] });
  assert.equal((await sellersPOST(new NextRequest('http://seller.test' + path, { method: 'POST', body: raw }))).status, 401);
  assert.equal((await sellersPOST(signed({ sellerIds: [A] }, 'z'.repeat(40)))).status, 401);
  assert.equal(
    (await sellersPOST(new NextRequest('http://seller.test' + path, { method: 'POST', body: raw, headers: { authorization: 'Bearer ' + tokenA, 'content-type': 'application/json' } }))).status,
    401,
    'a seller cannot read another seller\'s plan',
  );
  for (const bad of [{ sellerIds: [] }, { sellerIds: ['nope'] }, { sellerIds: Array.from({ length: 101 }, () => A) }, { sellerIds: [A], extra: 1 }, {}]) {
    assert.equal((await sellersPOST(signed(bad))).status, 422, JSON.stringify(bad));
  }
});

test('toPlanUsage is pure: an override replaces only the store limit', () => {
  const plan = resolveEffectivePlan({ subscription: null, plans: { free: FREE }, now: NOW });
  const usage = toPlanUsage({ plan, storeLimitOverride: 4, used: { stores: 1, products: 2 } });
  assert.deepEqual([usage.limits.stores, usage.limits.products, usage.storeLimitOverridden], [4, 10, true]);
  assert.equal(toPlanUsage({ plan, storeLimitOverride: 0, used: { stores: 1, products: 2 } }).storeLimitOverridden, false, '0 is not an override');
});
