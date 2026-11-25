import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { PlatformSettingsModel, Store, User } from '@/lib/services';
import type { AuthContext } from '@/lib/auth';
import { DEFAULT_ENV_STORE_LIMIT, STORE_LIMIT_SOURCES, parseEnvStoreLimit, positiveWhole, resolveStoreLimit } from '../src/lib/effective-limits';
import { effectiveStoreLimitFor, loadWorkspace, maxStoresPerSeller, provisionStore } from '../src/lib/workspace';

// Sprint 6 EP-12.US02.T01 (D-118): store limit = seller override > plan limit > platform maxStoresPerSeller > env SELLER_MAX_STORES.
// The resolver is pure; the workspace glue is tested with the models stubbed in memory (no database).

// ---------------------------------------------------------------------------------------------------------------- the pure rule

test('the sources are override, plan, setting and env, in that order', () => {
  assert.deepEqual([...STORE_LIMIT_SOURCES], ['override', 'plan', 'setting', 'env']);
});

test('step 1: the seller override wins over everything below it', () => {
  assert.deepEqual(resolveStoreLimit({ override: 7, planLimit: 3, platformMax: 5, envMax: '9' }), { limit: 7, source: 'override' });
  // an override LOWER than the plan also wins: the admin may lower a limit
  assert.deepEqual(resolveStoreLimit({ override: 1, planLimit: 3, platformMax: 5, envMax: '9' }), { limit: 1, source: 'override' });
});

test('step 2: with no override the plan limit wins over the platform setting and the environment', () => {
  assert.deepEqual(resolveStoreLimit({ planLimit: 3, platformMax: 5, envMax: '9' }), { limit: 3, source: 'plan' });
  assert.deepEqual(resolveStoreLimit({ override: null, planLimit: 1, platformMax: 5, envMax: '9' }), { limit: 1, source: 'plan' });
});

test('step 3: with no override and no plan the platform setting wins over the environment', () => {
  assert.deepEqual(resolveStoreLimit({ platformMax: 5, envMax: '9' }), { limit: 5, source: 'setting' });
  assert.deepEqual(resolveStoreLimit({ override: null, planLimit: undefined, platformMax: 2, envMax: '9' }), { limit: 2, source: 'setting' });
});

test('step 4: the environment, and the built-in 3 when the environment says nothing usable', () => {
  assert.deepEqual(resolveStoreLimit({ envMax: '9' }), { limit: 9, source: 'env' });
  assert.deepEqual(resolveStoreLimit({ envMax: 4 }), { limit: 4, source: 'env' });
  assert.deepEqual(resolveStoreLimit({}), { limit: DEFAULT_ENV_STORE_LIMIT, source: 'env' });
  assert.equal(DEFAULT_ENV_STORE_LIMIT, 3);
  for (const envMax of ['', 'abc', '0', '-2', undefined, null, 0, 1.5, {}]) {
    assert.deepEqual(resolveStoreLimit({ envMax }), { limit: 3, source: 'env' }, String(envMax));
  }
});

test('an unusable value at a step is skipped, never used as a limit', () => {
  for (const bad of [0, -1, 1.5, '3', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, true, {}]) {
    assert.equal(positiveWhole(bad), null, String(bad));
    assert.deepEqual(resolveStoreLimit({ override: bad, planLimit: bad, platformMax: 6, envMax: '9' }), { limit: 6, source: 'setting' }, String(bad));
  }
  assert.deepEqual(resolveStoreLimit({ override: 0, planLimit: 4, platformMax: 6, envMax: '9' }), { limit: 4, source: 'plan' });
  assert.deepEqual(resolveStoreLimit({ override: 2.5, planLimit: null, platformMax: null, envMax: '9' }), { limit: 9, source: 'env' });
});

test('the limit is never below 1', () => {
  for (const inputs of [{}, { override: 0 }, { platformMax: 0, envMax: '0' }, { envMax: '-5' }]) assert.ok(resolveStoreLimit(inputs).limit >= 1);
  assert.equal(resolveStoreLimit({ override: 1 }).limit, 1);
});

test('the environment is read like it always was: parseInt, whole numbers of 1 or more', () => {
  assert.equal(parseEnvStoreLimit('5'), 5);
  assert.equal(parseEnvStoreLimit(' 5 '), 5);
  assert.equal(parseEnvStoreLimit('5abc'), 5);
  assert.equal(parseEnvStoreLimit('3.9'), 3);
  assert.equal(parseEnvStoreLimit(''), null);
  assert.equal(parseEnvStoreLimit('abc'), null);
  assert.equal(parseEnvStoreLimit('0'), null);
  assert.equal(parseEnvStoreLimit('-1'), null);
  assert.equal(parseEnvStoreLimit(7), 7);
  assert.equal(parseEnvStoreLimit(0), null);
  assert.equal(parseEnvStoreLimit(undefined), null);
});

test('the resolver does not read the environment itself: the same inputs give the same answer', () => {
  const before = process.env.SELLER_MAX_STORES;
  process.env.SELLER_MAX_STORES = '12';
  try {
    assert.deepEqual(resolveStoreLimit({}), { limit: 3, source: 'env' });
    assert.deepEqual(resolveStoreLimit({ envMax: '12' }), { limit: 12, source: 'env' });
  } finally {
    if (before === undefined) delete process.env.SELLER_MAX_STORES;
    else process.env.SELLER_MAX_STORES = before;
  }
});

// ------------------------------------------------------------------------------------------- the workspace glue (models stubbed)

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
  // The demo seed claims the store first; a claim that changes nothing ends it at once (no database is reached).
  StoreModel.updateOne = async () => ({ modifiedCount: 0 });
  restore = () => {
    (mongoose as any).connect = saved.connect;
    SettingsModel.findOne = saved.settings;
    UserModel.findById = saved.userFindById;
    StoreModel.countDocuments = saved.count;
    StoreModel.find = saved.find;
    StoreModel.create = saved.create;
    StoreModel.updateOne = saved.updateOne;
    delete process.env.SELLER_MAX_STORES;
  };
});

afterEach(() => restore());

test('effectiveStoreLimitFor gathers the platform setting and the environment', async () => {
  assert.deepEqual(await effectiveStoreLimitFor(null), { limit: 3, source: 'env' });
  process.env.SELLER_MAX_STORES = '6';
  assert.deepEqual(await effectiveStoreLimitFor(null), { limit: 6, source: 'env' });
  assert.equal(maxStoresPerSeller(), 6);
  settingsDoc = { maxStoresPerSeller: 4 };
  assert.deepEqual(await effectiveStoreLimitFor(undefined), { limit: 4, source: 'setting' });
  assert.deepEqual(await effectiveStoreLimitFor(null, 2), { limit: 2, source: 'plan' });
  assert.deepEqual(await effectiveStoreLimitFor(9, 2), { limit: 9, source: 'override' });
});

test('loadWorkspace reports the limit, where it comes from, and never the override itself in the user', async () => {
  userDoc = { ...userDoc, storeLimitOverride: 5 };
  ownedStores = 2;
  const workspace = await loadWorkspace(ctx);
  assert.deepEqual(workspace.limits, { used: 2, max: 5, canCreate: true, source: 'override' });
  assert.equal('limitOverride' in workspace.user, false);
  assert.equal('storeLimitOverride' in workspace.user, false);
  assert.deepEqual(Object.keys(workspace.user).sort(), ['accountStatus', 'email', 'id', 'name']);
});

test('loadWorkspace: the platform setting and then the environment apply when the seller has no override', async () => {
  settingsDoc = { maxStoresPerSeller: 2 };
  ownedStores = 2;
  assert.deepEqual((await loadWorkspace(ctx)).limits, { used: 2, max: 2, canCreate: false, source: 'setting' });
  settingsDoc = null;
  process.env.SELLER_MAX_STORES = '8';
  assert.deepEqual((await loadWorkspace(ctx)).limits, { used: 2, max: 8, canCreate: true, source: 'env' });
});

test('loadWorkspace: a suspended seller cannot create, whatever the limit', async () => {
  userDoc = { ...userDoc, accountStatus: 'suspended', storeLimitOverride: 50 };
  assert.equal((await loadWorkspace(ctx)).limits.canCreate, false);
});

test('provisionStore: an override of 1 stops the second store with STORE_LIMIT_REACHED and says why', async () => {
  userDoc = { ...userDoc, storeLimitOverride: 1 };
  ownedStores = 1;
  const result = await provisionStore(ctx, 'Second Store');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: 'Store limit reached.', code: 'STORE_LIMIT_REACHED', used: 1, max: 1, source: 'override' });
  assert.equal(created.length, 0);
});

test('provisionStore: an override of 5 lets a seller with 3 stores create a 4th, though the setting says 3', async () => {
  settingsDoc = { maxStoresPerSeller: 3 };
  userDoc = { ...userDoc, storeLimitOverride: 5 };
  ownedStores = 3;
  const result = await provisionStore(ctx, 'Fourth Store');
  assert.equal(result.ok, true);
  assert.equal(created.length, 1);
});

test('provisionStore: with no override the platform setting decides, then the environment', async () => {
  settingsDoc = { maxStoresPerSeller: 2 };
  ownedStores = 2;
  const refused = await provisionStore(ctx, 'Third Store');
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal((refused.body as { source: string }).source, 'setting');

  settingsDoc = null;
  process.env.SELLER_MAX_STORES = '2';
  const again = await provisionStore(ctx, 'Third Store');
  assert.equal(again.ok, false);
  if (!again.ok) assert.deepEqual([(again.body as { max: number }).max, (again.body as { source: string }).source], [2, 'env']);
});

test('provisionStore: a suspended seller is refused before any limit is read', async () => {
  userDoc = { ...userDoc, accountStatus: 'suspended' };
  const result = await provisionStore(ctx, 'Any Store');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});
