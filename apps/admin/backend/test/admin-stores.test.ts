import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, Store, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { buildStoreFilter, escapeRegex, listEnvelope, parseStoreListQuery } from '@/lib/admin-stores';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const OWNER_ID = '65a000000000000000000002';
const STORE_ID = '65a000000000000000000010';
const NOW = new Date('2026-10-11T10:00:00.000Z');

const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;

let listGET: (request: Request) => Promise<Response>;
let detailGET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  listGET = (await import('../src/app/api/admin/stores/route')).GET;
  detailGET = (await import('../src/app/api/admin/stores/[id]/route')).GET;
});

function query(rows: unknown) {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => rows };
  return q;
}

interface Stub {
  role?: string;
  stores?: unknown[];
  total?: number;
  store?: unknown;
  audit?: unknown[];
}

const calls: { find: unknown[]; count: unknown[]; skip: number[] } = { find: [], count: [], skip: [] };

function install(stub: Stub): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    find: StoreModel.find,
    count: StoreModel.countDocuments,
    findById: StoreModel.findById,
    userFindById: UserModel.findById,
    userFind: UserModel.find,
    auditFind: AuditModel.find,
  };
  calls.find.length = 0;
  calls.count.length = 0;
  calls.skip.length = 0;
  (mongoose as any).connect = async () => mongoose;
  StoreModel.find = (filter: unknown) => {
    calls.find.push(filter);
    const q: any = { select: () => q, sort: () => q, skip: (n: number) => (calls.skip.push(n), q), limit: () => q, lean: async () => stub.stores ?? [] };
    return q;
  };
  StoreModel.countDocuments = async (filter: unknown) => (calls.count.push(filter), stub.total ?? (stub.stores ?? []).length);
  StoreModel.findById = () => query(stub.store ?? null);
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: stub.role ?? 'admin' }) }) });
  UserModel.find = () => ({ select: () => ({ lean: async () => [{ _id: OWNER_ID, name: 'Owner', email: 'owner@example.com' }, { _id: ADMIN_ID, name: 'Op Erator', email: 'op@example.com' }] }) });
  AuditModel.find = () => query(stub.audit ?? []);
  return () => {
    (mongoose as any).connect = originals.connect;
    StoreModel.find = originals.find;
    StoreModel.countDocuments = originals.count;
    StoreModel.findById = originals.findById;
    UserModel.findById = originals.userFindById;
    UserModel.find = originals.userFind;
    AuditModel.find = originals.auditFind;
  };
}

async function request(path: string, token?: string | null): Promise<Request> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  return new Request('http://admin.test' + path, { headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });
}

const storeDoc = {
  _id: STORE_ID,
  name: 'Lahore Looms',
  slug: 'lahore-looms',
  status: 'active',
  domain: 'looms.example.com',
  isThemeDemo: false,
  commissionRate: 7.5,
  commissionMode: 'custom',
  owner: OWNER_ID,
  statusChangedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  govRevision: 2,
  opsRevision: 1,
  storefront: { activeTheme: 'classic' },
  billing: { stripeOnboardingStatus: 'complete', stripeChargesEnabled: true },
};

test('parseStoreListQuery applies defaults and refuses malformed values', () => {
  const ok = parseStoreListQuery(new URLSearchParams());
  assert.deepEqual(ok, { ok: true, query: { page: 1, limit: 20, q: null, status: null } });
  for (const bad of ['page=0', 'page=abc', 'limit=101', 'limit=-1', 'status=deleted', 'q=' + 'a'.repeat(101)]) {
    assert.equal(parseStoreListQuery(new URLSearchParams(bad)).ok, false, bad);
  }
});

test('the search text is escaped, so it is matched literally', () => {
  assert.equal(escapeRegex('a.b*(c)'), 'a\\.b\\*\\(c\\)');
  const filter = buildStoreFilter({ page: 1, limit: 20, q: '.*', status: 'active' }) as any;
  assert.equal(filter.status, 'active');
  assert.equal(filter.$or[0].name.$regex, '\\.\\*');
  assert.equal(filter.$or.length, 3);
  assert.equal((buildStoreFilter({ page: 1, limit: 20, q: STORE_ID, status: null }) as any).$or.length, 4);
});

test('listEnvelope reports paging', () => {
  const e = listEnvelope([1, 2], { page: 2, limit: 2, totalDocs: 5 });
  assert.deepEqual([e.totalPages, e.hasNextPage, e.hasPrevPage], [3, true, true]);
  assert.equal(listEnvelope([], { page: 1, limit: 20, totalDocs: 0 }).totalPages, 0);
});

test('the list needs a token: none, a seller token, and a token for a demoted account are all 401', async () => {
  const restore = install({ role: 'admin' });
  try {
    assert.equal((await listGET(await request('/api/admin/stores', null))).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await listGET(await request('/api/admin/stores', seller))).status, 401);
  } finally {
    restore();
  }
  const demoted = install({ role: 'seller' });
  try {
    assert.equal((await listGET(await request('/api/admin/stores'))).status, 401);
  } finally {
    demoted();
  }
});

test('the list answers the envelope with id, never _id, and the owner resolved', async () => {
  const restore = install({ stores: [storeDoc], total: 41 });
  try {
    const response = await listGET(await request('/api/admin/stores?page=2&limit=20&status=active&q=loom'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.totalDocs, 41);
    assert.equal(body.totalPages, 3);
    assert.equal(body.page, 2);
    assert.equal(body.docs[0].id, STORE_ID);
    assert.equal('_id' in body.docs[0], false);
    assert.deepEqual(body.docs[0].owner, { id: OWNER_ID, name: 'Owner', email: 'owner@example.com' });
    assert.equal(body.docs[0].createdAt, NOW.toISOString());
    assert.equal((calls.find[0] as any).status, 'active');
    assert.equal(calls.skip[0], 20);
  } finally {
    restore();
  }
});

test('an invalid list query is 422 and reads nothing', async () => {
  const restore = install({ stores: [storeDoc] });
  try {
    const response = await listGET(await request('/api/admin/stores?status=deleted'));
    assert.equal(response.status, 422);
    assert.equal(calls.find.length, 0);
  } finally {
    restore();
  }
});

test('the detail returns the store, the owner, and governance history with the actor name', async () => {
  const audit = [{ _id: '65a000000000000000000099', action: 'store.suspend', actorId: ADMIN_ID, createdAt: NOW, details: { reason: 'chargebacks', note: null, before: { status: 'active' }, after: { status: 'suspended' } } }];
  const restore = install({ store: storeDoc, audit });
  try {
    const response = await detailGET(await request('/api/admin/stores/' + STORE_ID), { params: Promise.resolve({ id: STORE_ID }) });
    assert.equal(response.status, 200);
    const { store } = (await response.json()) as any;
    assert.equal(store.id, STORE_ID);
    assert.equal(store.activeTheme, 'classic');
    assert.equal(store.stripeChargesEnabled, true);
    assert.equal(store.history[0].actor.name, 'Op Erator');
    assert.deepEqual([store.history[0].from, store.history[0].to, store.history[0].reason], ['active', 'suspended', 'chargebacks']);
  } finally {
    restore();
  }
});

test('the detail answers 404 for a malformed id and for a store that does not exist', async () => {
  const restore = install({ store: null });
  try {
    assert.equal((await detailGET(await request('/api/admin/stores/zzz'), { params: Promise.resolve({ id: 'zzz' }) })).status, 404);
    assert.equal((await detailGET(await request('/api/admin/stores/' + STORE_ID), { params: Promise.resolve({ id: STORE_ID }) })).status, 404);
    assert.equal((await detailGET(await request('/api/admin/stores/' + STORE_ID, null), { params: Promise.resolve({ id: STORE_ID }) })).status, 401);
  } finally {
    restore();
  }
});
