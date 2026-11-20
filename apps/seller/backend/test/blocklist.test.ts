import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, BlockedContact, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { isContactBlocked } from '@/lib/fraud';

// Sprint 5 EP-11.US02 (D-107): the blocklist routes (list, add, remove) and the one yes/no question the checkout asks of it. Every model is
// stubbed in memory (no database); the unique { store, kind, value } index is enforced by the stub.

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const T0 = new Date('2026-11-14T10:00:00Z');

const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;
const BlockModel = BlockedContact as any;

type Row = Record<string, any>;
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let rows: Row[] = [];
let stores: Row[] = [];
let users: Record<string, Row> = {};
let audits: Row[] = [];
let seq = 0;
let existsFilters: Row[] = [];
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};
let listGET: Handler;
let addPOST: Handler;
let removeDELETE: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  listGET = (await import('../src/app/api/stores/[id]/blocklist/route')).GET as Handler;
  addPOST = (await import('../src/app/api/stores/[id]/blocklist/route')).POST as Handler;
  removeDELETE = (await import('../src/app/api/stores/[id]/blocklist/[contactId]/route')).DELETE as Handler;
});

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);
const chain = (read: () => unknown) => {
  let cap: number | null = null;
  const q: any = {
    select: () => q,
    sort: () => q,
    limit: (n: number) => {
      cap = n;
      return q;
    },
    lean: async () => {
      const value = read();
      return Array.isArray(value) && cap !== null ? value.slice(0, cap) : value;
    },
  };
  return q;
};
const matchesOr = (row: Row, or: Row[]): boolean => or.some((branch) => Object.entries(branch).every(([k, v]) => same(row[k], v)));

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    store: Object.fromEntries(['findOne', 'exists'].map((m) => [m, StoreModel[m]])),
    user: UserModel.findById,
    audit: AuditModel.create,
    block: Object.fromEntries(['find', 'countDocuments', 'create', 'findOneAndDelete', 'exists'].map((m) => [m, BlockModel[m]])),
  };
  rows = [];
  existsFilters = [];
  seq = 0;
  audits = [];
  stores = [
    { _id: STORE_A, owner: USER_A, name: 'Zara Lawn' },
    { _id: STORE_B, owner: USER_B, name: 'Bilal Shoes' },
  ];
  users = {
    [USER_A]: { _id: USER_A, role: 'seller', email: 'a@seller.test', emailVerifiedAt: T0 },
    [USER_B]: { _id: USER_B, role: 'seller', email: 'b@seller.test', emailVerifiedAt: T0 },
    [ADMIN]: { _id: ADMIN, role: 'admin', email: 'admin@markazify.test', emailVerifiedAt: T0 },
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findOne = (filter: Row) =>
    chain(() => {
      const row = stores.find((s) => same(s._id, filter._id) && (filter.owner === undefined || same(s.owner, filter.owner)));
      return row ? structuredClone(row) : null;
    });
  StoreModel.exists = async (filter: Row) => (stores.some((s) => same(s._id, filter._id) && same(s.owner, filter.owner)) ? { _id: filter._id } : null);
  UserModel.findById = (id: unknown) => chain(() => users[String(id)] ?? null);
  AuditModel.create = async (doc: Row) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  BlockModel.find = (filter: Row) =>
    chain(() =>
      rows
        .filter((row) => same(row.store, filter.store))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a._id < b._id ? 1 : -1))
        .map((row) => ({ ...row })),
    );
  BlockModel.countDocuments = async (filter: Row) => rows.filter((row) => same(row.store, filter.store)).length;
  BlockModel.create = async (doc: Row) => {
    if (rows.some((row) => same(row.store, doc.store) && row.kind === doc.kind && row.value === doc.value)) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    }
    seq += 1;
    const row = { _id: '65a0000000000000000e' + String(seq).padStart(4, '0'), ...doc, createdAt: new Date(T0.getTime() + seq * 1000), updatedAt: T0 };
    rows.push(row);
    return { ...row };
  };
  BlockModel.findOneAndDelete = (filter: Row) =>
    chain(() => {
      const index = rows.findIndex((row) => same(row._id, filter._id) && same(row.store, filter.store));
      if (index === -1) return null;
      return rows.splice(index, 1)[0];
    });
  BlockModel.exists = async (filter: Row) => {
    existsFilters.push(filter);
    const hit = rows.find((row) => same(row.store, filter.store) && matchesOr(row, filter.$or));
    return hit ? { _id: hit._id } : null;
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    UserModel.findById = saved.user;
    AuditModel.create = saved.audit;
    for (const [m, fn] of Object.entries(saved.block)) BlockModel[m] = fn;
  };
});

afterEach(() => restore());

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

function call(handler: Handler, method: string, store: string, token: string | null, tail = '', body?: unknown, params: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  return handler(
    new NextRequest('http://seller.test/api/stores/' + store + '/blocklist' + tail, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: store, ...params }) },
  );
}

const list = (store = STORE_A, token: string | null = tokenA) => call(listGET, 'GET', store, token);
const add = (body: unknown, store = STORE_A, token: string | null = tokenA) => call(addPOST, 'POST', store, token, '', body);
const remove = (contactId: string, store = STORE_A, token: string | null = tokenA) => call(removeDELETE, 'DELETE', store, token, '/' + contactId, undefined, { contactId });
const json = async (res: Response) => (await res.json()) as any;

// ---------------------------------------------------------------------------------------------------------------------
// Add

test('add: a phone in any spelling is stored as +923xxxxxxxxx, an email in lower case, with an optional reason', async () => {
  const phone = await add({ kind: 'phone', value: '0300-1234567', reason: '  Fake orders  ' });
  assert.equal(phone.status, 201);
  const body = await json(phone);
  assert.equal(body.contact.kind, 'phone');
  assert.equal(body.contact.value, '+923001234567');
  assert.equal(body.contact.reason, 'Fake orders');
  assert.ok(body.contact.id);
  assert.deepEqual(Object.keys(body.contact).sort(), ['createdAt', 'id', 'kind', 'reason', 'value']);

  const email = await add({ kind: 'email', value: '  Fraud@Example.PK ' });
  assert.equal(email.status, 201);
  assert.equal((await json(email)).contact.value, 'fraud@example.pk');
  assert.equal((await json(await add({ kind: 'phone', value: '+92 300 7654321' }))).contact.reason, '');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => String(row.store) === STORE_A));
  assert.equal(String(rows[0]!.createdBy), USER_A);
});

test('add: every spelling of one phone is the same contact (409 on the second)', async () => {
  assert.equal((await add({ kind: 'phone', value: '03001234567' })).status, 201);
  for (const spelling of ['0300 1234567', '+923001234567', '923001234567', '00923001234567']) {
    const again = await add({ kind: 'phone', value: spelling });
    assert.equal(again.status, 409, spelling);
    const body = await json(again);
    assert.equal(body.code, 'BLOCKLIST_EXISTS');
    assert.equal(body.field, 'value');
  }
  assert.equal(rows.length, 1);
  // The same text as an email is a different kind, and the other store has its own list.
  assert.equal((await add({ kind: 'email', value: 'a@b.pk' })).status, 201);
  assert.equal((await add({ kind: 'phone', value: '03001234567' }, STORE_B, tokenB)).status, 201);
});

test('add: a bad body is 400 and names the field; nothing is stored', async () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'kind'],
    [{ kind: 'address', value: 'x' }, 'kind'],
    [{ kind: 'phone' }, 'value'],
    [{ kind: 'phone', value: 'not a number' }, 'value'],
    [{ kind: 'phone', value: '12345' }, 'value'],
    [{ kind: 'email', value: 'no-at-sign' }, 'value'],
    [{ kind: 'email', value: 'a@b' }, 'value'],
    [{ kind: 'phone', value: 5 }, 'value'],
    [{ kind: 'phone', value: '03001234567', reason: 'x'.repeat(101) }, 'reason'],
    [{ kind: 'phone', value: '03001234567', reason: 'a <script>' }, 'reason'],
    [{ kind: 'phone', value: '03001234567', store: STORE_B }, 'store'],
    [{ kind: 'phone', value: '03001234567', createdBy: USER_B }, 'createdBy'],
    ['not json', 'body'],
  ];
  for (const [body, field] of cases) {
    const res = await add(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await json(res)).field, field, JSON.stringify(body));
  }
  assert.equal(rows.length, 0);
  assert.equal(audits.length, 0);
});

test('add: a reason of exactly 100 characters is accepted', async () => {
  assert.equal((await add({ kind: 'phone', value: '03001234567', reason: 'r'.repeat(100) })).status, 201);
});

test('add: at most 500 contacts per store (422 BLOCKLIST_FULL); another store is not affected', async () => {
  for (let i = 0; i < 500; i += 1) rows.push({ _id: 'seed-' + i, store: STORE_A, kind: 'email', value: 'user' + i + '@example.pk', reason: '', createdAt: T0 });
  const res = await add({ kind: 'phone', value: '03001234567' });
  assert.equal(res.status, 422);
  const body = await json(res);
  assert.equal(body.code, 'BLOCKLIST_FULL');
  assert.equal(rows.length, 500);
  assert.equal((await add({ kind: 'phone', value: '03001234567' }, STORE_B, tokenB)).status, 201);
});

// ---------------------------------------------------------------------------------------------------------------------
// List and remove

test('list: newest first, only this store, with the total and the limit', async () => {
  await add({ kind: 'phone', value: '03001111111', reason: 'first' });
  await add({ kind: 'email', value: 'second@example.pk' });
  await add({ kind: 'phone', value: '03002222222' }, STORE_B, tokenB);
  const res = await list();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await json(res);
  assert.deepEqual(body.docs.map((d: Row) => d.value), ['second@example.pk', '+923001111111']);
  assert.equal(body.total, 2);
  assert.equal(body.limit, 500);
  assert.equal((await json(await list(STORE_B, tokenB))).docs.length, 1);
});

test('remove: takes the contact off the list; a second remove and a malformed id are 404', async () => {
  const id = (await json(await add({ kind: 'phone', value: '03001234567' }))).contact.id;
  const res = await remove(id);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { removed: true, id });
  assert.equal(rows.length, 0);
  assert.equal((await remove(id)).status, 404);
  assert.equal((await remove('not-an-id')).status, 404);
});

test("isolation: Seller B can neither read, add to nor remove from Seller A's blocklist", async () => {
  const id = (await json(await add({ kind: 'phone', value: '03001234567' }))).contact.id;
  // A's store id with B's session is 403 for every call.
  assert.equal((await list(STORE_A, tokenB)).status, 403);
  assert.equal((await add({ kind: 'phone', value: '03009999999' }, STORE_A, tokenB)).status, 403);
  assert.equal((await remove(id, STORE_A, tokenB)).status, 403);
  // A's contact id under B's own store is simply not found, and it is still there.
  assert.equal((await remove(id, STORE_B, tokenB)).status, 404);
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0]!.store), STORE_A);
  // Nothing of A's list shows in B's.
  assert.equal((await json(await list(STORE_B, tokenB))).docs.length, 0);
});

test('access: no login is 401 and an admin session is 403 on every route', async () => {
  const id = (await json(await add({ kind: 'phone', value: '03001234567' }))).contact.id;
  for (const token of [null, tokenAdmin]) {
    const expected = token === null ? 401 : 403;
    assert.equal((await list(STORE_A, token)).status, expected);
    assert.equal((await add({ kind: 'phone', value: '03008888888' }, STORE_A, token)).status, expected);
    assert.equal((await remove(id, STORE_A, token)).status, expected);
  }
  assert.equal(rows.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Audit

test('audit: adding and removing are audited by kind only, never the phone, the email or the reason', async () => {
  const id = (await json(await add({ kind: 'phone', value: '0300 1234567', reason: 'Prank caller' }))).contact.id;
  await add({ kind: 'email', value: 'fraud@example.pk' });
  await remove(id);
  assert.deepEqual(audits.map((a) => a.action), ['blocklist.add', 'blocklist.add', 'blocklist.remove']);
  for (const audit of audits) assert.deepEqual(Object.keys(audit.details).sort(), ['at', 'kind', 'storeId']);
  assert.deepEqual(audits.map((a) => a.details.kind), ['phone', 'email', 'phone']);
  const text = JSON.stringify(audits);
  for (const secret of ['1234567', 'fraud@example.pk', 'Prank caller']) assert.equal(text.includes(secret), false, secret);
});

test('audit: a failing audit store never fails the change', async () => {
  AuditModel.create = async () => {
    throw new Error('audit store down');
  };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await add({ kind: 'phone', value: '03001234567' })).status, 201);
  } finally {
    console.error = original;
  }
  assert.equal(rows.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// The checkout question

test('checkout: a blocked phone is found in every spelling, compared as its phoneKey', async () => {
  await add({ kind: 'phone', value: '0300 1234567' });
  for (const spelling of ['03001234567', '0300-1234567', '+923001234567', '+92 300 1234567', '923001234567', '00923001234567']) {
    assert.equal(await isContactBlocked(STORE_A, { phone: spelling }), true, spelling);
  }
  assert.equal(await isContactBlocked(STORE_A, { phone: '03001234568' }), false);
  // It was asked as the normalized key, in one query.
  const last = existsFilters[existsFilters.length - 1]!;
  assert.deepEqual(last.$or, [{ kind: 'phone', value: '+923001234568' }]);
});

test('checkout: a blocked email is found whatever its case; a phone and an email are asked together', async () => {
  await add({ kind: 'email', value: 'fraud@example.pk' });
  assert.equal(await isContactBlocked(STORE_A, { phone: '03005550000', email: 'FRAUD@Example.pk ' }), true);
  assert.equal(await isContactBlocked(STORE_A, { email: 'other@example.pk' }), false);
  existsFilters = [];
  await isContactBlocked(STORE_A, { phone: '03005550000', email: 'x@y.pk' });
  assert.equal(existsFilters.length, 1, 'one query');
  assert.equal(existsFilters[0]!.$or.length, 2);
});

test('checkout: the list belongs to one store, and a contact with nothing to check asks nothing', async () => {
  await add({ kind: 'phone', value: '03001234567' });
  assert.equal(await isContactBlocked(STORE_B, { phone: '03001234567' }), false, "Store B has its own list; A's entry does not apply");
  existsFilters = [];
  assert.equal(await isContactBlocked(STORE_A, { phone: 'not a phone', email: null }), false);
  assert.equal(await isContactBlocked(STORE_A, {}), false);
  assert.equal(existsFilters.length, 0);
});
