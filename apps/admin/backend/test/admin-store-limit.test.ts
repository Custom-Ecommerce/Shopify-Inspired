import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, PlatformSettingsModel, Store, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { describeStoreLimit, envStoreLimit, storeLimitSteps, DEFAULT_ENV_STORE_LIMIT } from '@/lib/admin-store-limit';

// Sprint 6 EP-12.US02.T02, T03 (D-118): an admin sets or clears a seller's store-limit override with a reason; the call follows the
// seller status call (D-093): compare-and-set here, the signed call to the seller backend, a put-back when it fails, a best-effort audit entry.
// Models are stubbed in memory and the seller backend call is replaced; no database, no network.

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000003';
const OTHER_ADMIN = '65a000000000000000000004';
const SELLER_ID = '65a000000000000000000001';
const SELLER_WITH_LIMIT = '65a000000000000000000002';
const UserModel = User as any;
const StoreModel = Store as any;
const SettingsModel = PlatformSettingsModel as any;
const AuditModel = AuditLog as any;

let users: Record<string, Record<string, any>>;
let audits: Array<Record<string, any>>;
let applied: unknown[];
let failApply: boolean;
let ownedStores: number;
let settingsDoc: Record<string, unknown> | null;
let conflict: boolean;
let restore: () => void = () => {};
let route: {
  GET: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
  POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
};

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  route = (await import('../src/app/api/admin/sellers/[id]/store-limit/route')) as unknown as typeof route;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value(), exec: async () => value() };
  return q;
};

beforeEach(() => {
  users = {
    [ADMIN_ID]: { _id: ADMIN_ID, role: 'admin', email: 'op@example.com', name: 'Op', accountStatus: 'active', tokenVersion: 0 },
    [OTHER_ADMIN]: { _id: OTHER_ADMIN, role: 'admin', email: 'op2@example.com', accountStatus: 'active', tokenVersion: 0 },
    [SELLER_ID]: { _id: SELLER_ID, role: 'seller', email: 'ayesha@example.com', name: 'Ayesha', accountStatus: 'active', tokenVersion: 0 },
    [SELLER_WITH_LIMIT]: { _id: SELLER_WITH_LIMIT, role: 'seller', email: 'sana@example.com', name: 'Sana', accountStatus: 'active', tokenVersion: 0, storeLimitOverride: 6 },
  };
  audits = [];
  applied = [];
  failApply = false;
  ownedStores = 2;
  settingsDoc = null;
  conflict = false;
  delete process.env.SELLER_MAX_STORES;
  const saved = {
    connect: (mongoose as any).connect,
    findById: UserModel.findById,
    findOneAndUpdate: UserModel.findOneAndUpdate,
    updateOne: UserModel.updateOne,
    count: StoreModel.countDocuments,
    settings: SettingsModel.findOne,
    audit: AuditModel.create,
    apply: storeLimitSteps.applyInSellerBackend,
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = (id: unknown) => chain(() => (users[String(id)] ? { ...users[String(id)] } : null));
  UserModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = users[String(filter._id)];
      if (conflict || !row || row.role !== filter.role) return null;
      if ((row.storeLimitOverride ?? null) !== filter.storeLimitOverride) return null;
      Object.assign(row, update.$set);
      return { ...row };
    });
  UserModel.updateOne = async (filter: any, update: any) => {
    const row = users[String(filter._id)];
    if (row && (row.storeLimitOverride ?? null) === filter.storeLimitOverride) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0 };
  };
  StoreModel.countDocuments = async () => ownedStores;
  SettingsModel.findOne = () => chain(() => settingsDoc);
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  storeLimitSteps.applyInSellerBackend = async (_adminId: string, input: { userId: string; storeLimitOverride: number | null }) => {
    if (failApply) throw new Error('seller backend down');
    applied.push(input);
    return { userId: input.userId, storeLimitOverride: input.storeLimitOverride, changed: true };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findById = saved.findById;
    UserModel.findOneAndUpdate = saved.findOneAndUpdate;
    UserModel.updateOne = saved.updateOne;
    StoreModel.countDocuments = saved.count;
    SettingsModel.findOne = saved.settings;
    AuditModel.create = saved.audit;
    storeLimitSteps.applyInSellerBackend = saved.apply;
    delete process.env.SELLER_MAX_STORES;
  };
});

afterEach(() => restore());

const token = (id = ADMIN_ID) => signSession({ sub: id, role: 'admin', tv: 0 }, SECRET, ADMIN_AUDIENCE);
const url = (id: string) => 'http://admin.test/api/admin/sellers/' + id + '/store-limit';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = async (id: string, body: unknown, bearer?: string | null) =>
  route.POST(
    new Request(url(id), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer === null ? {} : { authorization: 'Bearer ' + (bearer ?? (await token())) }) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx(id),
  );
const get = async (id: string, bearer?: string | null) =>
  route.GET(new Request(url(id), { headers: bearer === null ? {} : { authorization: 'Bearer ' + (bearer ?? (await token())) } }), ctx(id));

// ------------------------------------------------------------------------------------------------------- the pure resolver

test('the effective limit follows override > plan > platform setting > environment, and says where it comes from', () => {
  assert.deepEqual(describeStoreLimit({ override: 7, planLimit: 3, platformMax: 5, envMax: '9' }), {
    effectiveLimit: 7,
    source: 'override',
    storeLimitOverride: 7,
    planLimit: 3,
    platformMax: 5,
    envMax: 9,
  });
  assert.equal(describeStoreLimit({ planLimit: 3, platformMax: 5, envMax: '9' }).source, 'plan');
  assert.equal(describeStoreLimit({ planLimit: 3, platformMax: 5, envMax: '9' }).effectiveLimit, 3);
  assert.equal(describeStoreLimit({ platformMax: 5, envMax: '9' }).source, 'setting');
  assert.equal(describeStoreLimit({ platformMax: 5, envMax: '9' }).effectiveLimit, 5);
  assert.deepEqual([describeStoreLimit({ envMax: '9' }).effectiveLimit, describeStoreLimit({ envMax: '9' }).source], [9, 'env']);
  assert.deepEqual([describeStoreLimit({}).effectiveLimit, describeStoreLimit({}).source], [DEFAULT_ENV_STORE_LIMIT, 'env']);
});

test('an unusable value at a step is skipped, as in the seller backend', () => {
  for (const bad of [0, -1, 1.5, '3', null, undefined, Number.NaN]) {
    assert.deepEqual([describeStoreLimit({ override: bad, planLimit: bad, platformMax: 4 }).effectiveLimit, describeStoreLimit({ override: bad, planLimit: bad, platformMax: 4 }).source], [4, 'setting'], String(bad));
  }
  assert.equal(envStoreLimit('5'), 5);
  assert.equal(envStoreLimit('abc'), null);
  assert.equal(envStoreLimit('0'), null);
  assert.equal(envStoreLimit(undefined), null);
});

// ------------------------------------------------------------------------------------------------------------------- POST

test('setting the override needs a reason, is applied in the seller backend, and is audited with the reason', async () => {
  const response = await post(SELLER_ID, { storeLimitOverride: 5, reason: 'Agency with five brands' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seller: { id: SELLER_ID, storeLimitOverride: 5, changed: true } });
  assert.equal(users[SELLER_ID]!.storeLimitOverride, 5);
  assert.deepEqual(applied, [{ userId: SELLER_ID, storeLimitOverride: 5 }]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'seller.store_limit_set');
  assert.equal(audits[0]!.entityId ?? audits[0]!.entity_id, SELLER_ID);
  assert.deepEqual([audits[0]!.details.from, audits[0]!.details.to, audits[0]!.details.reason], [null, 5, 'Agency with five brands']);
});

test('clearing the override (null) is applied and audited as a clear', async () => {
  const response = await post(SELLER_WITH_LIMIT, { storeLimitOverride: null, reason: 'Back to the plan limit' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seller: { id: SELLER_WITH_LIMIT, storeLimitOverride: null, changed: true } });
  assert.equal(users[SELLER_WITH_LIMIT]!.storeLimitOverride, null);
  assert.deepEqual(applied, [{ userId: SELLER_WITH_LIMIT, storeLimitOverride: null }]);
  assert.equal(audits[0]!.action, 'seller.store_limit_cleared');
  assert.deepEqual([audits[0]!.details.from, audits[0]!.details.to], [6, null]);
});

test('a reason is always required, to set and to clear, and a bad limit names its field (400)', async () => {
  const noReason = await post(SELLER_ID, { storeLimitOverride: 5 });
  assert.equal(noReason.status, 400);
  assert.equal(((await noReason.json()) as { field: string }).field, 'reason');
  assert.equal((await post(SELLER_ID, { storeLimitOverride: null })).status, 400);
  assert.equal((await post(SELLER_ID, { storeLimitOverride: 5, reason: 'no' })).status, 400);
  assert.equal((await post(SELLER_ID, { storeLimitOverride: 5, reason: 'x'.repeat(301) })).status, 400);

  for (const bad of [0, -2, 2.5, '5', 1001, undefined]) {
    const response = await post(SELLER_ID, { storeLimitOverride: bad, reason: 'A fine reason' });
    assert.equal(response.status, 400, String(bad));
    assert.equal(((await response.json()) as { field: string }).field, 'storeLimitOverride', String(bad));
  }
  assert.equal((await post(SELLER_ID, { storeLimitOverride: 5, reason: 'A fine reason', role: 'admin' })).status, 400, 'an unknown key');
  assert.equal((await post(SELLER_ID, 'not json')).status, 400);
  assert.equal(applied.length + audits.length, 0);
  assert.equal(users[SELLER_ID]!.storeLimitOverride, undefined);
});

test('the same override again changes nothing here, is still applied in the seller backend (a retry completes a half-done change), and is not audited', async () => {
  const response = await post(SELLER_WITH_LIMIT, { storeLimitOverride: 6, reason: 'Same value again' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seller: { id: SELLER_WITH_LIMIT, storeLimitOverride: 6, changed: false } });
  assert.equal(applied.length, 1);
  assert.equal(audits.length, 0);
});

test('an unknown seller and a bad id are 404, an admin account is 403 NOT_A_SELLER, and nothing is applied', async () => {
  assert.equal((await post('65a0000000000000000000ff', { storeLimitOverride: 5, reason: 'Unknown seller' })).status, 404);
  assert.equal((await post('not-an-id', { storeLimitOverride: 5, reason: 'Bad id' })).status, 404);
  const other = await post(OTHER_ADMIN, { storeLimitOverride: 5, reason: 'Not a seller' });
  assert.equal(other.status, 403);
  assert.equal(((await other.json()) as { code: string }).code, 'NOT_A_SELLER');
  assert.equal(applied.length + audits.length, 0);
  assert.equal(users[OTHER_ADMIN]!.storeLimitOverride, undefined);
});

test('a change made by someone else in between is a 409, and nothing is applied or audited', async () => {
  conflict = true;
  const response = await post(SELLER_ID, { storeLimitOverride: 5, reason: 'Racing operators' });
  assert.equal(response.status, 409);
  assert.equal(applied.length + audits.length, 0);
});

test('when the seller backend cannot apply it, the admin copy is put back and nothing is audited (rollback)', async () => {
  failApply = true;
  const response = await post(SELLER_WITH_LIMIT, { storeLimitOverride: 9, reason: 'Seller backend is down' });
  assert.equal(response.status, 500);
  assert.equal(users[SELLER_WITH_LIMIT]!.storeLimitOverride, 6, 'the console never shows a limit the seller backend does not enforce');
  assert.equal(audits.length, 0);

  const fresh = await post(SELLER_ID, { storeLimitOverride: 4, reason: 'Seller backend is down' });
  assert.equal(fresh.status, 500);
  assert.equal(users[SELLER_ID]!.storeLimitOverride ?? null, null);
});

test('a failed audit entry does not undo a change that was applied', async () => {
  AuditModel.create = async () => {
    throw new Error('audit down');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    const response = await post(SELLER_ID, { storeLimitOverride: 5, reason: 'Audit is down' });
    assert.equal(response.status, 200);
    assert.equal(users[SELLER_ID]!.storeLimitOverride, 5);
  } finally {
    console.error = quiet;
  }
});

test('a non-admin is refused: no session, a seller session, and a token for the wrong audience all fail before anything is read or written', async () => {
  const body = { storeLimitOverride: 99, reason: 'I want more stores' };
  assert.equal((await post(SELLER_ID, body, null)).status, 401);
  // a seller account signing a token for the admin console: the account is read and its role is not admin
  const asSeller = await signSession({ sub: SELLER_ID, role: 'seller', tv: 0 }, SECRET, ADMIN_AUDIENCE);
  assert.equal((await post(SELLER_ID, body, asSeller)).status, 401);
  const wrongAudience = await signSession({ sub: ADMIN_ID, role: 'admin', tv: 0 }, SECRET, 'seller-backend');
  assert.equal((await post(SELLER_ID, body, wrongAudience)).status, 401);
  assert.equal((await get(SELLER_ID, asSeller)).status, 401);
  assert.equal(applied.length + audits.length, 0);
  assert.equal(users[SELLER_ID]!.storeLimitOverride, undefined);
});

test('the policy: the route needs the sellers/storeLimitOverride permission, which only an admin and the system have', async () => {
  const { assertCan } = await import('@/lib/workspace');
  assert.doesNotThrow(() => assertCan('admin', 'update', 'sellers', ['storeLimitOverride']));
  for (const actor of ['seller', 'public'] as const) assert.throws(() => assertCan(actor, 'update', 'sellers', ['storeLimitOverride']), actor);
});

// -------------------------------------------------------------------------------------------------------------------- GET

test('GET shows the override as the effective limit, with where it comes from and how many stores the seller has', async () => {
  settingsDoc = { maxStoresPerSeller: 4 };
  process.env.SELLER_MAX_STORES = '8';
  ownedStores = 3;
  const response = await get(SELLER_WITH_LIMIT);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    seller: {
      id: SELLER_WITH_LIMIT,
      name: 'Sana',
      email: 'sana@example.com',
      storeLimitOverride: 6,
      effectiveLimit: 6,
      source: 'override',
      storesUsed: 3,
      planLimit: null,
      platformMax: 4,
      envMax: 8,
    },
  });
});

test('GET without an override shows the platform setting, then the environment, then the default 3', async () => {
  settingsDoc = { maxStoresPerSeller: 4 };
  process.env.SELLER_MAX_STORES = '8';
  let body = (await (await get(SELLER_ID)).json()) as { seller: { effectiveLimit: number; source: string; storeLimitOverride: number | null } };
  assert.deepEqual([body.seller.effectiveLimit, body.seller.source, body.seller.storeLimitOverride], [4, 'setting', null]);

  settingsDoc = null;
  body = (await (await get(SELLER_ID)).json()) as typeof body;
  assert.deepEqual([body.seller.effectiveLimit, body.seller.source], [8, 'env']);

  delete process.env.SELLER_MAX_STORES;
  body = (await (await get(SELLER_ID)).json()) as typeof body;
  assert.deepEqual([body.seller.effectiveLimit, body.seller.source], [3, 'env']);
});

test('GET: a settings read that fails falls back to the environment, an unknown seller is 404 and an admin account is 403', async () => {
  SettingsModel.findOne = () => ({
    select: () => ({
      lean: async () => {
        throw new Error('settings down');
      },
    }),
  });
  const response = await get(SELLER_ID);
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { seller: { source: string } }).seller.source, 'env');
  assert.equal((await get('65a0000000000000000000ff')).status, 404);
  assert.equal((await get(OTHER_ADMIN)).status, 403);
});
