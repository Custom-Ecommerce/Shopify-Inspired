import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { addressBookOf } from '@/lib/customers';
import { toDashboardOrderDetail } from '@/lib/orders';
import { installCustomersWorld, makeOrder, type CustomersWorld, type Row } from './helpers/customers-world';

// Sprint 5 EP-10.US03.T01 (D-107): a customer's address book, seller side only: the distinct delivery addresses taken from their orders.
// The pipelines are interpreted by ./helpers/customers-world (it throws on a stage it does not know).

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const T0 = new Date('2026-11-14T10:00:00Z');
const PHONE = '+923001234567';

const StoreModel = Store as any;
const UserModel = User as any;

type Ctx = { params: Promise<{ id: string; key: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let world: CustomersWorld;
let stores: Record<string, Row> = {};
let users: Record<string, Row> = {};
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};
let addressesGET: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  addressesGET = (await import('../src/app/api/stores/[id]/customers/[key]/addresses/route')).GET as Handler;
});

const chain = (read: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => read() };
  return q;
};

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    store: Object.fromEntries(['findOne', 'exists'].map((m) => [m, StoreModel[m]])),
    user: UserModel.findById,
  };
  world = installCustomersWorld();
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, name: 'Zara Lawn' },
    [STORE_B]: { _id: STORE_B, owner: USER_B, name: 'Bilal Shoes' },
  };
  users = {
    [USER_A]: { _id: USER_A, role: 'seller', email: 'a@seller.test', emailVerifiedAt: T0 },
    [USER_B]: { _id: USER_B, role: 'seller', email: 'b@seller.test', emailVerifiedAt: T0 },
    [ADMIN]: { _id: ADMIN, role: 'admin', email: 'admin@markazify.test', emailVerifiedAt: T0 },
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findOne = (filter: Row) =>
    chain(() => {
      const row = stores[String(filter._id)];
      return row && (filter.owner === undefined || String(row.owner) === String(filter.owner)) ? structuredClone(row) : null;
    });
  StoreModel.exists = async (filter: Row) => (stores[String(filter._id)] && String(stores[String(filter._id)]!.owner) === String(filter.owner) ? { _id: filter._id } : null);
  UserModel.findById = (id: unknown) => chain(() => users[String(id)] ?? null);
  restore = () => {
    world.restore();
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    UserModel.findById = saved.user;
  };
});

afterEach(() => restore());

const sell = (store: string, fields: Row = {}): Row => {
  const order = makeOrder(store, fields);
  world.orders.push(order);
  return order;
};

async function book(key: string, store = STORE_A, token: string | null = tokenA) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await addressesGET(
    new NextRequest('http://seller.test/api/stores/' + store + '/customers/' + encodeURIComponent(key) + '/addresses', { headers }),
    { params: Promise.resolve({ id: store, key }) },
  );
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

const at = (iso: string) => ({ createdAt: new Date(iso) });

// ---------------------------------------------------------------------------------------------------------------------
// The pure rule

test('addressBookOf: the same address and city (trimmed, lower case) is one entry, with its order count and last used date', () => {
  const entries = addressBookOf([
    { orderId: 'A', address: 'House 1, Street 2', city: 'Lahore', createdAt: '2026-11-01T10:00:00Z' },
    { orderId: 'B', address: '  house 1,   STREET 2 ', city: ' lahore ', createdAt: '2026-11-05T10:00:00Z' },
    { orderId: 'C', address: 'House 9, Block 4', city: 'Karachi', createdAt: '2026-11-03T10:00:00Z' },
    { orderId: 'D', address: 'House 1, Street 2', city: 'Lahore', createdAt: '2026-11-07T10:00:00Z' },
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { address: 'House 1, Street 2', city: 'Lahore', orderCount: 3, lastUsedAt: '2026-11-07T10:00:00.000Z' });
  assert.deepEqual(entries[1], { address: 'House 9, Block 4', city: 'Karachi', orderCount: 1, lastUsedAt: '2026-11-03T10:00:00.000Z' });
});

test('addressBookOf: newest first by last use, whatever order the orders arrive in', () => {
  const entries = addressBookOf([
    { address: 'Old place', city: 'Quetta', createdAt: '2026-10-01T10:00:00Z' },
    { address: 'New place', city: 'Multan', createdAt: '2026-11-09T10:00:00Z' },
    { address: 'Middle place', city: 'Sukkur', createdAt: '2026-10-20T10:00:00Z' },
  ]);
  assert.deepEqual(entries.map((e) => e.address), ['New place', 'Middle place', 'Old place']);
});

test('addressBookOf: the same street in another city is another address; an order with no address adds none; a missing city is its own form', () => {
  const entries = addressBookOf([
    { address: 'Main Road', city: 'Lahore', createdAt: '2026-11-01T10:00:00Z' },
    { address: 'Main Road', city: 'Karachi', createdAt: '2026-11-02T10:00:00Z' },
    { address: null, city: 'Karachi', createdAt: '2026-11-03T10:00:00Z' },
    { address: '   ', city: 'Karachi', createdAt: '2026-11-04T10:00:00Z' },
    { address: 'Main Road', city: null, createdAt: '2026-11-05T10:00:00Z' },
  ]);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.city), [null, 'Karachi', 'Lahore']);
});

test('addressBookOf: the entry shows the newest order\'s spelling, and the list is capped', () => {
  const [entry] = addressBookOf([
    { address: 'house 1 street 2', city: 'lahore', createdAt: '2026-11-01T10:00:00Z' },
    { address: 'House 1 Street 2', city: 'Lahore', createdAt: '2026-11-02T10:00:00Z' },
  ]);
  assert.equal(entry!.address, 'House 1 Street 2');
  assert.equal(entry!.city, 'Lahore');
  const many = Array.from({ length: 30 }, (_, i) => ({ address: 'Street ' + i, city: 'Lahore', createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)).toISOString() }));
  assert.equal(addressBookOf(many).length, 20);
  assert.equal(addressBookOf(many, 5).length, 5);
});

// ---------------------------------------------------------------------------------------------------------------------
// The route

test('GET addresses: the customer\'s distinct addresses newest first, one per address, with counts and dates', async () => {
  sell(STORE_A, { phone: '0300 1234567', address: 'House 1, Street 2', city: 'Lahore', ...at('2026-11-01T10:00:00Z') });
  sell(STORE_A, { phone: '+923001234567', address: 'house 1, street 2 ', city: 'LAHORE', ...at('2026-11-04T10:00:00Z') });
  sell(STORE_A, { phone: '03001234567', address: 'Flat 7, Mall Road', city: 'Karachi', ...at('2026-11-06T10:00:00Z') });
  sell(STORE_A, { phone: '03009998888', address: 'Somebody else', city: 'Lahore', ...at('2026-11-07T10:00:00Z') });
  const res = await book(PHONE);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(res.body, {
    addresses: [
      { address: 'Flat 7, Mall Road', city: 'Karachi', orderCount: 1, lastUsedAt: '2026-11-06T10:00:00.000Z' },
      // The newest order that used it supplies the spelling (trimmed).
      { address: 'house 1, street 2', city: 'LAHORE', orderCount: 2, lastUsedAt: '2026-11-04T10:00:00.000Z' },
    ],
  });
});

test('GET addresses: any spelling of the phone in the URL reaches the same customer; an email key works for a customer with no phone', async () => {
  sell(STORE_A, { phone: '03001234567', address: 'House 1', city: 'Lahore' });
  for (const spelling of ['03001234567', '0300 1234567', '+923001234567', '923001234567']) {
    const res = await book(spelling);
    assert.equal(res.status, 200, spelling);
    assert.equal(res.body.addresses.length, 1);
  }
  sell(STORE_A, { phone: '', customerEmail: 'noPhone@Example.pk', address: 'Email street', city: 'Multan' });
  const byEmail = await book('nophone@example.pk');
  assert.equal(byEmail.status, 200);
  assert.deepEqual(byEmail.body.addresses.map((a: Row) => a.address), ['Email street']);
});

test("GET addresses: the book is built from THIS store's orders only; another store's customer is 404", async () => {
  sell(STORE_A, { phone: '03001234567', address: 'Store A address', city: 'Lahore' });
  sell(STORE_B, { phone: '03001234567', address: 'Store B address', city: 'Karachi' });
  sell(STORE_B, { phone: '03007770000', address: 'Only in B', city: 'Karachi' });
  assert.deepEqual((await book(PHONE, STORE_A, tokenA)).body.addresses.map((a: Row) => a.address), ['Store A address']);
  assert.deepEqual((await book(PHONE, STORE_B, tokenB)).body.addresses.map((a: Row) => a.address), ['Store B address']);
  // A customer that only store B has is not found in store A.
  assert.equal((await book('+923007770000', STORE_A, tokenA)).status, 404);
  // Every pipeline began with the store of the URL.
  for (const pipeline of world.pipelines) assert.ok(pipeline[0]?.$match?.store, 'the first stage is scoped by the store');
});

test("GET addresses: Seller B cannot read Seller A's store (403); an admin is refused; no login is 401", async () => {
  sell(STORE_A, { phone: '03001234567', address: 'House 1', city: 'Lahore' });
  assert.equal((await book(PHONE, STORE_A, tokenB)).status, 403);
  assert.equal((await book(PHONE, STORE_A, tokenAdmin)).status, 403);
  assert.equal((await book(PHONE, STORE_A, null)).status, 401);
  assert.equal(world.pipelines.length, 0, 'nothing was read');
});

test('GET addresses: a key that is neither a mobile number nor an email is 400 naming the key; an unknown customer is 404', async () => {
  const bad = await book('12345');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'key');
  assert.equal((await book('+923001112222')).status, 404);
});

test('GET addresses: a customer whose orders have no address has an empty book (200), not a 404', async () => {
  sell(STORE_A, { phone: '03001234567', address: '   ', city: 'Lahore' });
  const res = await book(PHONE);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { addresses: [] });
});

// ---------------------------------------------------------------------------------------------------------------------
// The order page's link to the customer

test('the order detail carries the customer key the address book is read with (the customer page link)', () => {
  const order = sell(STORE_A, { phone: '0300 1234567', address: 'House 1', city: 'Lahore' });
  assert.equal(toDashboardOrderDetail(order).customerKey, PHONE);
});
