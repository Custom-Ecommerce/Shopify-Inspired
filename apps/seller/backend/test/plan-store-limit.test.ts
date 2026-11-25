import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { PlatformSettingsModel, Store, User } from '@/lib/services';
import type { AuthContext } from '@/lib/auth';
import { setPlanLoader, type EffectivePlan } from '../src/lib/plan';
import { UNLIMITED_STORES_SHOWN, loadWorkspace, provisionStore, storeLimitWithPlan } from '../src/lib/workspace';

// Sprint 6 EP-14.US02 (D-118): the store limit is override > plan > platform setting > env. The plan comes from the effective-plan loader (installed
// here); the models are stubbed in memory. No database.

const SELLER = '65a000000000000000000001';
const ctx = { userId: SELLER, userObjectId: new mongoose.Types.ObjectId(SELLER), role: 'seller', actor: 'seller' } as AuthContext;
const SettingsModel = PlatformSettingsModel as any;
const UserModel = User as any;
const StoreModel = Store as any;

let settingsDoc: Record<string, unknown> | null;
let userDoc: Record<string, unknown>;
let ownedStores: number;
let created: Array<Record<string, unknown>>;
let restore: () => void = () => {};

const planOf = (stores: number | null, key = 'free', products: number | null = 10): EffectivePlan => ({
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
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  delete process.env.SELLER_MAX_STORES;
  settingsDoc = null;
  userDoc = { name: 'Ali', email: 'ali@example.test', accountStatus: 'active' };
  ownedStores = 0;
  created = [];
  const saved = {
    connect: (mongoose as any).connect,
    settings: SettingsModel.findOne,
    userFindById: UserModel.findById,
    count: StoreModel.countDocuments,
    find: StoreModel.find,
    create: StoreModel.create,
    updateOne: StoreModel.updateOne,
  };
  (mongoose as any).connect = async () => mongoose;
  SettingsModel.findOne = () => chain(() => settingsDoc);
  UserModel.findById = () => chain(() => userDoc);
  StoreModel.countDocuments = async () => ownedStores;
  StoreModel.find = () => chain(() => Array.from({ length: ownedStores }, (_, i) => ({ _id: 's' + i, name: 'Store ' + i, slug: 'store-' + i, status: 'active' })));
  StoreModel.create = async (doc: Record<string, unknown>) => {
    created.push(doc);
    return { ...doc, _id: '65a0000000000000000000ff' };
  };
  StoreModel.updateOne = async () => ({ modifiedCount: 0 });
  restore = () => {
    (mongoose as any).connect = saved.connect;
    SettingsModel.findOne = saved.settings;
    UserModel.findById = saved.userFindById;
    StoreModel.countDocuments = saved.count;
    StoreModel.find = saved.find;
    StoreModel.create = saved.create;
    StoreModel.updateOne = saved.updateOne;
    setPlanLoader(null);
    delete process.env.SELLER_MAX_STORES;
  };
});

afterEach(() => restore());

// ------------------------------------------------------------------------------------------------------------------ the order

test('override > plan > platform setting > environment, each step on its own', async () => {
  settingsDoc = { maxStoresPerSeller: 4 };
  process.env.SELLER_MAX_STORES = '6';
  setPlanLoader(async () => planOf(2, 'growth'));
  assert.deepEqual(await storeLimitWithPlan(SELLER, 9), { limit: 9, source: 'override' });
  assert.deepEqual(await storeLimitWithPlan(SELLER, null), { limit: 2, source: 'plan' });
  setPlanLoader(null);
  assert.deepEqual(await storeLimitWithPlan(SELLER, null), { limit: 4, source: 'setting' }, 'no plan to check: the platform setting');
  settingsDoc = null;
  assert.deepEqual(await storeLimitWithPlan(SELLER, null), { limit: 6, source: 'env' });
});

test('the override beats the plan in both directions: a higher one lifts a Free seller, a lower one holds a Growth seller', async () => {
  setPlanLoader(async () => planOf(1));
  assert.deepEqual(await storeLimitWithPlan(SELLER, 5), { limit: 5, source: 'override' });
  setPlanLoader(async () => planOf(3, 'growth'));
  assert.deepEqual(await storeLimitWithPlan(SELLER, 1), { limit: 1, source: 'override' });
});

test('a plan with no store limit is unlimited: it is not replaced by the setting or the environment (shown as 1000)', async () => {
  settingsDoc = { maxStoresPerSeller: 2 };
  setPlanLoader(async () => planOf(null, 'growth'));
  assert.deepEqual(await storeLimitWithPlan(SELLER, null), { limit: UNLIMITED_STORES_SHOWN, source: 'plan' });
  assert.equal(UNLIMITED_STORES_SHOWN, 1000);
});

// ------------------------------------------------------------------------------------------------------------------ workspace

test('loadWorkspace shows the plan\'s limit and its source, and an override as such', async () => {
  setPlanLoader(async () => planOf(1));
  ownedStores = 1;
  assert.deepEqual((await loadWorkspace(ctx)).limits, { used: 1, max: 1, canCreate: false, source: 'plan' });
  userDoc = { ...userDoc, storeLimitOverride: 3 };
  assert.deepEqual((await loadWorkspace(ctx)).limits, { used: 1, max: 3, canCreate: true, source: 'override' });
});

// ------------------------------------------------------------------------------------------------------------------ provisionStore

test('provisionStore: a Free seller with a store is refused the second with 403 PLAN_LIMIT_REACHED, the limit, the use, the plan and a hint', async () => {
  setPlanLoader(async () => planOf(1));
  ownedStores = 1;
  const result = await provisionStore(ctx, 'Second Store');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
  const body = result.body as { code: string; limitKind: string; limit: number; used: number; plan: string; upgradeHint: string; error: string };
  assert.deepEqual([body.code, body.limitKind, body.limit, body.used, body.plan], ['PLAN_LIMIT_REACHED', 'stores', 1, 1, 'free']);
  assert.ok(body.upgradeHint.length > 0);
  assert.match(body.error, /Free plan allows 1 stores/);
  assert.equal(created.length, 0, 'nothing is created');
});

test('provisionStore: the first store is allowed on Free, and a Growth seller may have up to 3', async () => {
  setPlanLoader(async () => planOf(1));
  ownedStores = 0;
  assert.equal((await provisionStore(ctx, 'First Store')).ok, true);
  setPlanLoader(async () => planOf(3, 'growth'));
  ownedStores = 2;
  assert.equal((await provisionStore(ctx, 'Third Store')).ok, true);
  ownedStores = 3;
  const refused = await provisionStore(ctx, 'Fourth Store');
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.status, 403);
});

test('provisionStore: an unlimited plan is never refused', async () => {
  setPlanLoader(async () => planOf(null, 'growth'));
  ownedStores = 40;
  assert.equal((await provisionStore(ctx, 'Store 41')).ok, true);
});

test('provisionStore: the seller\'s override wins over the plan, and its refusal is the long-standing 409 STORE_LIMIT_REACHED', async () => {
  userDoc = { ...userDoc, storeLimitOverride: 4 };
  setPlanLoader(async () => planOf(1));
  ownedStores = 3;
  assert.equal((await provisionStore(ctx, 'Fourth Store')).ok, true, 'a Free seller with an override of 4 may add a 4th');
  ownedStores = 4;
  const refused = await provisionStore(ctx, 'Fifth Store');
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body, { error: 'Store limit reached.', code: 'STORE_LIMIT_REACHED', used: 4, max: 4, source: 'override' });
  }
});

test('provisionStore: a seller already over a lowered limit keeps their stores (nothing is removed) and can only not add', async () => {
  setPlanLoader(async () => planOf(1));
  ownedStores = 3;
  const refused = await provisionStore(ctx, 'Another Store');
  assert.equal(refused.ok, false);
  assert.equal(created.length, 0);
  const workspace = await loadWorkspace(ctx);
  assert.equal(workspace.stores.length, 3, 'the three stores are all still listed');
  assert.deepEqual([workspace.limits.used, workspace.limits.max, workspace.limits.canCreate], [3, 1, false]);
});

test('provisionStore: a suspended account is refused before any plan is read', async () => {
  let loads = 0;
  setPlanLoader(async () => (loads++, planOf(1)));
  userDoc = { ...userDoc, accountStatus: 'suspended' };
  const result = await provisionStore(ctx, 'Any Store');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
  assert.equal(loads, 0);
});
