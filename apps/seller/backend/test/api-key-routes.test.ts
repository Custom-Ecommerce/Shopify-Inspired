import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { ApiKey, AuditLog, Store, SubscriptionPlanModel, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { checkApiKey } from '../src/lib/api-keys';
import { findApiKeyByPrefix } from '../src/lib/api-key-service';
import { setMembershipLoader } from '../src/lib/data-plane';
import { setPlanLoader } from '../src/lib/plan';
import { setSessionUserLoader } from '../src/lib/session-user';

// Sprint 8 (S8-B4, D-118): the API key routes. Owner only, plan gated, the secret answered once and never anywhere else. Models are in memory; no database.

const SECRET = 'x'.repeat(40);
const OWNER = '65a000000000000000000001';
const OWNER_B = '65a000000000000000000002';
const MANAGER = '65a000000000000000000003';
const STAFF = '65a000000000000000000004';
const SUPPORT = '65a000000000000000000005';
const ADMIN = '65a000000000000000000009';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';

const KeyModel = ApiKey as any;
const StoreModel = Store as any;
const AuditModel = AuditLog as any;
const PlanModel = SubscriptionPlanModel as any;

type Row = Record<string, any>;
let keys: Row[];
let audits: Row[];
let keyLimit: number | null;
let tokens: Record<string, string> = {};
let seq = 0;
let restore: () => void = () => {};

type Handler = (r: NextRequest, c: any) => Promise<Response>;
let listGET: Handler;
let createPOST: Handler;
let revokePOST: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  for (const [name, id, role] of [['owner', OWNER, 'seller'], ['ownerB', OWNER_B, 'seller'], ['manager', MANAGER, 'seller'], ['staff', STAFF, 'seller'], ['support', SUPPORT, 'seller'], ['admin', ADMIN, 'admin']] as const) {
    tokens[name] = await signSession({ sub: id, role }, SECRET, SELLER_AUDIENCE);
  }
  listGET = (await import('../src/app/api/stores/[id]/api-keys/route')).GET as Handler;
  createPOST = (await import('../src/app/api/stores/[id]/api-keys/route')).POST as Handler;
  revokePOST = (await import('../src/app/api/stores/[id]/api-keys/[keyId]/revoke/route')).POST as Handler;
});

const clone = <T>(value: T): T => structuredClone(value);
const matches = (row: Row, filter: Row): boolean =>
  Object.entries(filter).every(([key, wanted]) => (wanted === null ? row[key] === null || row[key] === undefined : String(row[key]) === String(wanted)));
/** What a read answers: the hash only when it is asked for, as select:false does. */
const visible = (row: Row, select: string): Row => {
  const copy = clone(row);
  if (!select.includes('+hash')) delete copy.hash;
  return copy;
};
function query(value: () => Row[] | Row | null) {
  let selected = '';
  const q: any = {
    select: (fields: string) => ((selected = fields), q),
    sort: () => q,
    lean: async () => {
      const out = value();
      if (out === null) return null;
      return Array.isArray(out) ? out.map((row) => visible(row, selected)) : visible(out, selected);
    },
  };
  return q;
}

beforeEach(() => {
  keys = [];
  audits = [];
  keyLimit = 2;
  seq = 0;
  const owners: Record<string, string> = { [STORE_A]: OWNER, [STORE_B]: OWNER_B };
  const members: Record<string, string> = { [MANAGER]: 'manager', [STAFF]: 'staff', [SUPPORT]: 'support' };
  const saved = {
    connect: (mongoose as any).connect,
    exists: StoreModel.exists,
    findById: StoreModel.findById,
    audit: AuditModel.create,
    plans: PlanModel.find,
    key: Object.fromEntries(['create', 'find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'updateOne'].map((m) => [m, KeyModel[m]])),
  };
  (mongoose as any).connect = async () => mongoose;
  setSessionUserLoader(async (id: string) => ({ role: id === ADMIN ? 'admin' : 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date() }) as never);
  setMembershipLoader(async (storeId, userId) => (storeId === STORE_A && members[userId] ? { role: members[userId] } : null));
  setPlanLoader(async () => ({ key: 'growth', name: 'Growth', status: 'active', limits: { stores: 3, products: null, staffSeats: 3, apiKeys: keyLimit, customDomain: true, premiumThemes: true } }) as never);
  PlanModel.find = () => query(() => []);
  StoreModel.exists = async (filter: any) => (owners[String(filter._id)] === String(filter.owner) ? { _id: filter._id } : null);
  StoreModel.findById = (id: unknown) => ({ select: () => ({ lean: async () => (owners[String(id)] ? { owner: owners[String(id)] } : null) }) });
  AuditModel.create = async (doc: Row) => (audits.push(doc), { _id: 'a' + audits.length });
  KeyModel.countDocuments = async (filter: Row) => keys.filter((row) => matches(row, filter)).length;
  KeyModel.create = async (doc: Row) => {
    if (keys.some((row) => row.prefix === doc.prefix)) throw Object.assign(new Error('E11000'), { code: 11000 });
    seq += 1;
    const row = { _id: '65a0000000000000000e' + String(seq).padStart(4, '0'), ...clone({ ...doc, createdBy: String(doc.createdBy) }), createdAt: new Date(Date.UTC(2026, 10, 25, 10, seq)) };
    keys.push(row);
    return clone(row);
  };
  KeyModel.find = (filter: Row) => query(() => keys.filter((row) => matches(row, filter)).slice().reverse());
  KeyModel.findOne = (filter: Row) => query(() => keys.find((row) => matches(row, filter)) ?? null);
  KeyModel.findOneAndUpdate = (filter: Row, update: Row) =>
    query(() => {
      const row = keys.find((r) => matches(r, filter));
      if (!row) return null;
      Object.assign(row, clone(update.$set));
      row.revision += update.$inc.revision;
      return row;
    });
  KeyModel.updateOne = async () => ({});
  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.exists = saved.exists;
    StoreModel.findById = saved.findById;
    AuditModel.create = saved.audit;
    PlanModel.find = saved.plans;
    for (const [m, fn] of Object.entries(saved.key)) KeyModel[m] = fn;
    setSessionUserLoader(null);
    setMembershipLoader(null);
    setPlanLoader(null);
  };
});

afterEach(() => restore());

function call(handler: Handler, method: string, path: string, options: { token?: string | null; body?: unknown; store?: string; keyId?: string } = {}) {
  const token = options.token === undefined ? tokens.owner : options.token;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const store = options.store ?? STORE_A;
  return handler(
    new NextRequest('http://seller.test' + path, { method, headers, body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body) }),
    { params: Promise.resolve({ id: store, ...(options.keyId === undefined ? {} : { keyId: options.keyId }) }) },
  );
}
const list = (options: Parameters<typeof call>[3] = {}) => call(listGET, 'GET', '/api/stores/' + (options.store ?? STORE_A) + '/api-keys', options);
const create = (body: unknown, options: Parameters<typeof call>[3] = {}) => call(createPOST, 'POST', '/api/stores/' + (options.store ?? STORE_A) + '/api-keys', { ...options, body });
const revoke = (keyId: string, options: Parameters<typeof call>[3] = {}) => call(revokePOST, 'POST', '/api/stores/' + (options.store ?? STORE_A) + '/api-keys/' + keyId + '/revoke', { ...options, keyId });
const json = async (res: Response) => (await res.json()) as any;
const BODY = { name: 'Accounting', scopes: ['products:read'] };

test('create: 201 with the full secret ONCE; only its hash is stored; the key view carries the public prefix and nothing secret', async () => {
  const res = await create(BODY);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await json(res);
  assert.match(body.secret, /^mkz_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
  assert.equal(body.key.name, 'Accounting');
  assert.deepEqual(body.key.scopes, ['products:read']);
  assert.equal(body.secret.startsWith(body.key.prefix + '_'), true);
  assert.equal(body.key.revokedAt, null);
  assert.equal(body.key.lastUsedAt, null);
  assert.equal('hash' in body.key, false);
  const row = keys[0]!;
  assert.equal(String(row.store), STORE_A);
  assert.equal(String(row.createdBy), OWNER);
  assert.match(row.hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes(body.secret.slice(-43)), false, 'the secret is never stored');
});

test('the secret never appears again: not in the list, the revoke answer, an audit entry or an error', async () => {
  const created = await json(await create(BODY));
  const secret = created.secret.slice(-43);
  const hash = keys[0]!.hash;
  const listed = await json(await list());
  const revoked = await json(await revoke(created.key.id));
  const missing = await json(await revoke('65a0000000000000000e9999'));
  for (const text of [JSON.stringify(listed), JSON.stringify(revoked), JSON.stringify(missing), JSON.stringify(audits)]) {
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(hash), false, 'nor its hash');
    assert.equal(text.includes(created.secret), false);
  }
  assert.deepEqual(audits.map((a) => a.action), ['api_key.create', 'api_key.revoke']);
  assert.equal(audits[0]!.actorId, 'seller:' + OWNER);
  assert.equal(audits[0]!.details.actorRole, 'owner');
  assert.equal(audits[0]!.details.prefix, created.key.prefix);
});

test('a bad create body is a 400 naming the field and writes nothing', async () => {
  const bad: Array<[unknown, string]> = [
    [{ scopes: ['products:read'] }, 'name'],
    [{ name: 'x'.repeat(41), scopes: ['products:read'] }, 'name'],
    [{ name: 'a', scopes: [] }, 'scopes'],
    [{ name: 'a', scopes: ['products:write'] }, 'scopes.0'],
    [{ name: 'a', scopes: ['products:read'], hash: 'a'.repeat(64) }, 'hash'],
    [{ name: 'a', scopes: ['products:read'], store: STORE_B }, 'store'],
    ['nope', 'body'],
  ];
  for (const [body, field] of bad) {
    const res = await create(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await json(res)).field, field, JSON.stringify(body));
  }
  assert.equal(keys.length, 0);
});

test('the plan gate: live keys count against limits.apiKeys (403 PLAN_LIMIT_REACHED); a revoked key frees its slot', async () => {
  keyLimit = 1;
  const first = await json(await create(BODY));
  const full = await create(BODY);
  assert.equal(full.status, 403);
  const refusal = await json(full);
  assert.equal(refusal.code, 'PLAN_LIMIT_REACHED');
  assert.equal(refusal.limitKind, 'apiKeys');
  assert.equal(refusal.limit, 1);
  assert.equal(refusal.used, 1);
  assert.match(refusal.errors[0].message, /API keys/);
  assert.equal(keys.length, 1);
  assert.equal((await revoke(first.key.id)).status, 200);
  assert.equal((await create(BODY)).status, 201, 'the revoked key holds no slot');
  assert.equal(keys.length, 2);
});

test('the Free plan (0 keys) refuses the first key; an unlimited plan never refuses', async () => {
  keyLimit = 0;
  assert.equal((await json(await create(BODY))).code, 'PLAN_LIMIT_REACHED');
  assert.equal(keys.length, 0);
  keyLimit = null;
  for (let i = 0; i < 4; i += 1) assert.equal((await create(BODY)).status, 201);
});

test('the list: newest first, with the live keys against the plan', async () => {
  await create({ name: 'one', scopes: ['products:read'] });
  const two = await json(await create({ name: 'two', scopes: ['orders:read'] }));
  await revoke(two.key.id);
  const body = await json(await list());
  assert.deepEqual(body.keys.map((k: Row) => k.name), ['two', 'one']);
  assert.ok(body.keys[0].revokedAt);
  assert.equal(body.keys[1].revokedAt, null);
  assert.deepEqual(body.usage, { used: 1, limit: 2 });
  assert.deepEqual(Object.keys(body.keys[0]).sort(), ['createdAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt', 'scopes']);
});

test('revoke is idempotent: the second revoke answers the same key, keeps the first date and writes no second audit entry', async () => {
  const created = await json(await create(BODY));
  const first = await json(await revoke(created.key.id));
  const second = await revoke(created.key.id);
  assert.equal(second.status, 200);
  assert.equal((await json(second)).key.revokedAt, first.key.revokedAt);
  assert.equal(audits.filter((a) => a.action === 'api_key.revoke').length, 1);
  assert.equal(keys[0]!.revision, 1);
});

test('a revoked key fails the check at once; a live one passes it', async () => {
  const created = await json(await create({ name: 'both', scopes: ['products:read', 'orders:read'] }));
  const deps = { findByPrefix: findApiKeyByPrefix };
  const ok = await checkApiKey('Bearer ' + created.secret, 'orders:read', deps);
  assert.equal(ok.status, 200);
  assert.equal(ok.ok && ok.key.storeId, STORE_A);
  await revoke(created.key.id);
  assert.equal((await checkApiKey('Bearer ' + created.secret, 'orders:read', deps)).status, 401);
});

test('only the owner: a manager, staff and support are 403 on every key route, no login is 401, an admin is 403, and nothing changes', async () => {
  const created = await json(await create(BODY));
  const calls: Array<[string, (token: string | null) => Promise<Response>]> = [
    ['list', (token) => list({ token })],
    ['create', (token) => create(BODY, { token })],
    ['revoke', (token) => revoke(created.key.id, { token })],
  ];
  for (const who of ['manager', 'staff', 'support']) {
    for (const [name, run] of calls) {
      const res = await run(tokens[who]!);
      assert.equal(res.status, 403, who + ' ' + name);
      assert.equal((await json(res)).code, 'CAPABILITY_DENIED', who + ' ' + name);
    }
  }
  for (const [name, run] of calls) {
    assert.equal((await run(null)).status, 401, name);
    assert.equal((await run(tokens.admin!)).status, 403, name);
  }
  assert.equal(keys.length, 1);
  assert.equal(keys[0]!.revokedAt, null);
});

test('isolation: another seller is 403 on Store A, a key of Store A under Store B is 404, and B sees only its own', async () => {
  const created = await json(await create(BODY));
  assert.equal((await list({ token: tokens.ownerB })).status, 403);
  assert.equal((await create(BODY, { token: tokens.ownerB })).status, 403);
  assert.equal((await revoke(created.key.id, { token: tokens.ownerB })).status, 403);
  const foreign = await revoke(created.key.id, { token: tokens.ownerB, store: STORE_B });
  assert.equal(foreign.status, 404);
  assert.equal((await json(foreign)).code, 'API_KEY_NOT_FOUND');
  assert.equal((await revoke('nope')).status, 404);
  assert.deepEqual((await json(await list({ token: tokens.ownerB, store: STORE_B }))).keys, []);
  assert.equal(keys[0]!.revokedAt, null);
  assert.equal((await list({ store: 'nope' })).status, 404);
});
