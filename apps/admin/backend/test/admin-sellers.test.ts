import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Store, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { STORE_PREVIEW, buildSellerFilter, groupStoresByOwner, parseSellerListQuery, toSellerItem } from '@/lib/admin-sellers';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const SELLER_ID = '65a000000000000000000002';
const OTHER_ID = '65a000000000000000000003';
const NOW = new Date('2026-10-11T10:00:00.000Z');

const StoreModel = Store as any;
const UserModel = User as any;

let GET: (request: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  GET = (await import('../src/app/api/admin/sellers/route')).GET;
});

const calls: { userFind: any[]; userCount: any[]; storeFind: any[]; skip: number[] } = { userFind: [], userCount: [], storeFind: [], skip: [] };

interface Stub {
  role?: string;
  sellers?: unknown[];
  total?: number;
  stores?: unknown[];
}

function install(stub: Stub): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    userFind: UserModel.find,
    userCount: UserModel.countDocuments,
    storeFind: StoreModel.find,
  };
  calls.userFind.length = 0;
  calls.userCount.length = 0;
  calls.storeFind.length = 0;
  calls.skip.length = 0;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: stub.role ?? 'admin' }) }) });
  UserModel.find = (filter: unknown) => {
    calls.userFind.push(filter);
    const q: any = { select: () => q, sort: () => q, skip: (n: number) => (calls.skip.push(n), q), limit: () => q, lean: async () => stub.sellers ?? [] };
    return q;
  };
  UserModel.countDocuments = async (filter: unknown) => (calls.userCount.push(filter), stub.total ?? (stub.sellers ?? []).length);
  StoreModel.find = (filter: unknown) => {
    calls.storeFind.push(filter);
    const q: any = { select: () => q, sort: () => q, lean: async () => stub.stores ?? [] };
    return q;
  };
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    UserModel.find = originals.userFind;
    UserModel.countDocuments = originals.userCount;
    StoreModel.find = originals.storeFind;
  };
}

async function request(path: string, token?: string | null): Promise<Request> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  return new Request('http://admin.test' + path, { headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });
}

const seller = { _id: SELLER_ID, name: 'Aisha Khan', email: 'aisha@example.com', createdAt: NOW };
const store = (id: string, name: string, owner: string, status = 'active') => ({ _id: id, name, status, owner });

test('parseSellerListQuery applies defaults and refuses malformed values', () => {
  assert.deepEqual(parseSellerListQuery(new URLSearchParams()), { ok: true, query: { page: 1, limit: 20, q: null } });
  for (const bad of ['page=0', 'page=abc', 'limit=101', 'limit=0', 'q=' + 'a'.repeat(101)]) {
    assert.equal(parseSellerListQuery(new URLSearchParams(bad)).ok, false, bad);
  }
});

test('the seller filter is limited to the seller role and the search text is matched literally', () => {
  const plain = buildSellerFilter({ page: 1, limit: 20, q: null }) as any;
  assert.deepEqual(plain, { role: 'seller' });
  const search = buildSellerFilter({ page: 1, limit: 20, q: '.*' }) as any;
  assert.equal(search.role, 'seller');
  assert.equal(search.$or[0].name.$regex, '\\.\\*');
  assert.equal(search.$or.length, 2);
  assert.equal((buildSellerFilter({ page: 1, limit: 20, q: SELLER_ID }) as any).$or.length, 3);
});

test('stores are grouped by owner, and the row previews a few stores but counts them all', () => {
  const stores = ['a', 'b', 'c', 'd'].map((n, i) => store('65a00000000000000000010' + i, 'Store ' + n, SELLER_ID));
  stores.push(store('65a000000000000000000019', 'Other', OTHER_ID));
  const grouped = groupStoresByOwner(stores);
  assert.equal(grouped.get(SELLER_ID)?.length, 4);
  const item = toSellerItem(seller, grouped.get(SELLER_ID) ?? []);
  assert.equal(item.storeCount, 4);
  assert.equal(item.stores.length, STORE_PREVIEW);
  assert.equal(item.id, SELLER_ID);
  assert.equal('_id' in item, false);
});

test('the list needs an admin token: none, a seller token, and a demoted account are all 401', async () => {
  const restore = install({});
  try {
    assert.equal((await GET(await request('/api/admin/sellers', null))).status, 401);
    const sellerToken = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await GET(await request('/api/admin/sellers', sellerToken))).status, 401);
  } finally {
    restore();
  }
  const demoted = install({ role: 'seller' });
  try {
    assert.equal((await GET(await request('/api/admin/sellers'))).status, 401);
    assert.equal(calls.userFind.length, 0);
  } finally {
    demoted();
  }
});

test('the list answers the envelope with id, never _id, and each seller with their stores', async () => {
  const restore = install({
    sellers: [seller],
    total: 41,
    stores: [store('65a000000000000000000010', 'Lahore Looms', SELLER_ID), store('65a000000000000000000011', 'Karachi Kurtas', SELLER_ID, 'suspended')],
  });
  try {
    const response = await GET(await request('/api/admin/sellers?page=2&limit=20&q=aisha'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.equal(body.totalDocs, 41);
    assert.equal(body.totalPages, 3);
    assert.equal(body.page, 2);
    assert.equal(body.docs[0].id, SELLER_ID);
    assert.equal('_id' in body.docs[0], false);
    assert.equal(body.docs[0].storeCount, 2);
    assert.deepEqual(body.docs[0].stores.map((s: any) => [s.name, s.status]), [['Lahore Looms', 'active'], ['Karachi Kurtas', 'suspended']]);
    assert.equal(calls.userFind[0].role, 'seller');
    assert.equal(calls.skip[0], 20);
    assert.deepEqual(calls.storeFind[0], { owner: { $in: [SELLER_ID] } });
    assert.equal('passwordHash' in body.docs[0], false);
  } finally {
    restore();
  }
});

test('an empty page does not query stores, and an invalid query is 422 and reads nothing', async () => {
  const restore = install({ sellers: [] });
  try {
    const empty = await GET(await request('/api/admin/sellers'));
    assert.equal(empty.status, 200);
    assert.equal(((await empty.json()) as any).totalPages, 0);
    assert.equal(calls.storeFind.length, 0);
    const bad = await GET(await request('/api/admin/sellers?page=0'));
    assert.equal(bad.status, 422);
    assert.equal(calls.userFind.length, 1);
  } finally {
    restore();
  }
});
