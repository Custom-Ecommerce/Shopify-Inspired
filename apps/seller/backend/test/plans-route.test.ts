import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { SubscriptionPlanModel, assertCan, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setSessionUserLoader } from '@/lib/session-user';
import { publicPlanListSchema } from '../../../../packages/contracts/src/plans';
import { PUBLIC_PLAN_FIELDS, toPublicPlan } from '../src/lib/plans';

// Sprint 6 EP-14.US01.T07 (D-118): GET /api/plans shows a seller the active plans, public fields only. The model is stubbed; no database.

const AUTH_SECRET = 'x'.repeat(40);
const SELLER = '65a000000000000000000001';
const ADMIN = '65a000000000000000000003';
const PlanModel = SubscriptionPlanModel as any;

let rows: Array<Record<string, any>>;
let finds: any[];
let tokenSeller = '';
let tokenAdmin = '';
let plansGET: (r: NextRequest) => Promise<Response>;
let restore: () => void = () => {};

const free = {
  _id: 'a1',
  key: 'free',
  name: 'Free',
  priceRs: 0,
  interval: 'month',
  limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false },
  features: ['Up to 10 products'],
  isActive: true,
  sortOrder: 1,
  stripePriceId: 'price_secret_1',
  revision: 7,
  archivedAt: null,
  tier: 'basic',
};
const growth = { ...free, _id: 'a2', key: 'growth', name: 'Growth', priceRs: 2500, limits: { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true }, sortOrder: 2 };

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenSeller = await signSession({ sub: SELLER, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, AUTH_SECRET, SELLER_AUDIENCE);
  plansGET = (await import('../src/app/api/plans/route')).GET;
});

beforeEach(() => {
  rows = [{ ...growth }, { ...free }];
  finds = [];
  setSessionUserLoader(async (id) => ({ role: id === ADMIN ? 'admin' : 'seller', accountStatus: 'active', tokenVersion: 0, emailVerified: true, emailVerifiedAt: new Date() }) as any);
  const saved = { connect: (mongoose as any).connect, find: PlanModel.find };
  (mongoose as any).connect = async () => mongoose;
  PlanModel.find = (filter: any) => {
    finds.push(filter);
    // The stub applies the two things the route asks of the database: active plans that have a key.
    const q: any = { select: () => q, sort: () => q, lean: async () => rows.filter((r) => r.isActive !== false && typeof r.key === 'string').sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((r) => ({ ...r })) };
    return q;
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    PlanModel.find = saved.find;
  };
});

afterEach(() => {
  restore();
  setSessionUserLoader(null);
});

const get = (token: string | null) => new NextRequest('http://seller.test/api/plans', token === null ? {} : { headers: { authorization: 'Bearer ' + token } });

test('a signed-in seller gets the active plans in the public view, and the answer passes the public contract', async () => {
  const res = await plansGET(get(tokenSeller));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as { plans: Array<Record<string, any>> };
  assert.equal(publicPlanListSchema.safeParse(body).success, true);
  assert.deepEqual(body.plans.map((p) => p.key), ['free', 'growth'], 'in sort order');
});

test('only the public fields leave: no Stripe price id, no revision, no archive data, no tier, no id', async () => {
  const body = (await (await plansGET(get(tokenSeller))).json()) as { plans: Array<Record<string, unknown>> };
  for (const plan of body.plans) {
    assert.deepEqual(Object.keys(plan).sort(), ['features', 'interval', 'key', 'limits', 'name', 'priceRs', 'sortOrder']);
  }
  const text = JSON.stringify(body);
  for (const secret of ['price_secret_1', 'revision', 'archivedAt', 'tier', '_id', 'stripePriceId']) assert.equal(text.includes(secret), false, secret);
});

test('limits keep null for unlimited, and money stays whole rupees', async () => {
  const body = (await (await plansGET(get(tokenSeller))).json()) as { plans: Array<Record<string, any>> };
  const g = body.plans.find((p) => p.key === 'growth')!;
  assert.equal(g.limits.products, null);
  assert.equal(g.priceRs, 2500);
  assert.equal(Number.isInteger(g.priceRs), true);
  assert.equal(body.plans.find((p) => p.key === 'free')!.priceRs, 0);
});

test('the route asks the database only for active plans that have a key, in sort order', async () => {
  await plansGET(get(tokenSeller));
  assert.deepEqual(finds[0], { isActive: { $ne: false }, key: { $type: 'string' } });
  assert.deepEqual([...PUBLIC_PLAN_FIELDS], ['key', 'name', 'priceRs', 'interval', 'limits', 'features', 'sortOrder', 'isActive']);
});

test('an archived plan and an old plan without key, price or limits are not listed', async () => {
  rows = [{ ...growth, isActive: false }, { _id: 'old', key: 'old', name: 'Old', isActive: true }, { _id: 'tier', name: 'Pro', tier: 'pro', stripePriceId: 'price_1' }, { ...free }];
  const body = (await (await plansGET(get(tokenSeller))).json()) as { plans: Array<Record<string, any>> };
  assert.deepEqual(body.plans.map((p) => p.key), ['free']);
});

test('no session is 401, an admin session is 403 and reads nothing, a bad token is 401', async () => {
  assert.equal((await plansGET(get(null))).status, 401);
  assert.equal((await plansGET(get('not-a-token'))).status, 401);
  finds.length = 0;
  assert.equal((await plansGET(get(tokenAdmin))).status, 403);
  assert.equal(finds.length, 0);
});

test('the policy: a seller reads exactly the public fields; the Stripe price and the revision are refused', () => {
  assert.doesNotThrow(() => assertCan('seller', 'read', 'subscriptionPlans', [...PUBLIC_PLAN_FIELDS]));
  for (const hidden of ['stripePriceId', 'revision', 'archivedAt', 'tier']) assert.throws(() => assertCan('seller', 'read', 'subscriptionPlans', [hidden]), hidden);
  for (const op of ['create', 'update', 'delete'] as const) assert.throws(() => assertCan('seller', op, 'subscriptionPlans'), op);
});

test('toPublicPlan: a complete plan maps, a fractional price or missing limits does not, junk limits become null or false', () => {
  assert.equal(toPublicPlan(free)!.key, 'free');
  assert.equal(toPublicPlan({ ...free, priceRs: 2500.5 }), null);
  assert.equal(toPublicPlan({ ...free, priceRs: undefined }), null);
  assert.equal(toPublicPlan({ ...free, limits: undefined }), null);
  assert.equal(toPublicPlan({ ...free, key: '' }), null);
  const junk = toPublicPlan({ ...free, limits: { stores: -1, products: 2.5, staffSeats: 'x', apiKeys: 4, customDomain: 'yes', premiumThemes: 1 } })!;
  assert.deepEqual(junk.limits, { stores: null, products: null, staffSeats: null, apiKeys: 4, customDomain: false, premiumThemes: false });
});
