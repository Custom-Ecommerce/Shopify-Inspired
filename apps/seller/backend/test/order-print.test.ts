import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { Order, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

// EP-02 OB-5b: GET /api/orders/print. Models are stubbed; no database.

const { orderPrintResponseSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';

const OrderModel = Order as any;
const StoreModel = Store as any;

const stores = [
  { _id: STORE_A, owner: USER_A, name: 'Sara Boutique' },
  { _id: STORE_B, owner: USER_B, name: 'Other Shop' },
];

const oid = (n: number): string => '65a0000000000000000a' + String(n).padStart(4, '0');

let orders: Array<Record<string, any>> = [];
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let selected = '';
let printGET: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  printGET = (await import('../src/app/api/orders/print/route')).GET;
});

let restore: (() => void) | null = null;

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    find: OrderModel.find,
    exists: StoreModel.exists,
    findOne: StoreModel.findOne,
    findById: StoreModel.findById,
  };
  orders = [];
  selected = '';
  (mongoose as any).connect = async () => mongoose;
  OrderModel.find = (filter: any) => {
    const q: any = {
      select: (fields: string) => {
        selected = fields;
        return q;
      },
      lean: async () => {
        const wanted: string[] = filter._id.$in;
        // Returned in stored order, not requested order, as MongoDB does.
        return orders.filter((row) => wanted.includes(String(row._id)) && String(row.store) === String(filter.store)).map((row) => ({ ...row }));
      },
    };
    return q;
  };
  StoreModel.exists = async (filter: any) => (stores.some((s) => s._id === String(filter._id) && s.owner === String(filter.owner)) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => {
    const q: any = { sort: () => q, select: () => q, lean: async () => stores.find((s) => s.owner === String(filter.owner)) ?? null };
    return q;
  };
  StoreModel.findById = (id: string) => {
    const q: any = { select: () => q, lean: async () => stores.find((s) => s._id === String(id)) ?? null };
    return q;
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    OrderModel.find = saved.find;
    StoreModel.exists = saved.exists;
    StoreModel.findOne = saved.findOne;
    StoreModel.findById = saved.findById;
  };
});

afterEach(() => {
  restore?.();
  restore = null;
});

function seed(n: number, fields: Record<string, any> = {}): string {
  orders.push({
    _id: oid(n),
    store: STORE_A,
    orderId: 'ORD-' + String(n).padStart(8, 'A'),
    status: 'dispatched',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    customerName: 'Sara Khan',
    phone: '+923001234567',
    address: 'House 12, Street 4, Block 5',
    city: 'Karachi',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Red / M', sku: 'SH-RM', unitPrice: 1200, quantity: 2 }],
    subtotal: 2400,
    deliveryCharges: 100,
    total: 2500,
    courier: 'TCS',
    trackingNumber: 'TCS-1',
    idempotencyKey: 'idem-key-1',
    requestFingerprint: 'fp-1',
    notes: [{ text: 'SECRET-NOTE', by: USER_A, at: new Date() }],
    statusHistory: [{ from: 'processing', to: 'dispatched', by: USER_A, at: new Date(), note: 'SECRET-HISTORY' }],
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...fields,
  });
  return oid(n);
}

async function print(ids: string | null, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  const query = ids === null ? '' : '?ids=' + encodeURIComponent(ids);
  const res = await printGET(new NextRequest('http://seller.test/api/orders/print' + query, { method: 'GET', headers: h }));
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, body: JSON.parse(text) as any };
}

test('print: no login 401; an admin session 403, even with a bad list', async () => {
  const id = seed(1);
  assert.equal((await print(id, null)).status, 401);
  assert.equal((await print(id, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await print('nope', tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
});

test("print: seller B naming seller A's store is 403; seller B on A's ids from their own store gets not_found", async () => {
  const id = seed(1);
  assert.equal((await print(id, tokenB, { 'x-store-id': STORE_A })).status, 403);
  const { status, body, text } = await print(id, tokenB);
  assert.equal(status, 200);
  assert.deepEqual(body.orders, []);
  assert.deepEqual(body.skipped, [{ id, reason: 'not_found' }]);
  assert.equal(body.store.name, 'Other Shop');
  assert.equal(text.includes('Sara Khan'), false);
});

test('print: a missing, empty or invalid list and more than 50 ids are 400 ORDER_QUERY_INVALID', async () => {
  const id = seed(1);
  const many = Array.from({ length: 51 }, (_, i) => oid(100 + i)).join(',');
  for (const ids of [null, '', '   ', 'not-an-id', id + ',nope', id + ',', ',' + id, '123456789012', many]) {
    const res = await print(ids);
    assert.equal(res.status, 400, String(ids));
    assert.equal(res.body.errors[0].code, 'ORDER_QUERY_INVALID');
    assert.equal(res.body.errors[0].field, 'ids');
  }
});

test('print: exactly 50 ids are fine, and duplicates do not count toward the limit', async () => {
  const fifty = Array.from({ length: 50 }, (_, i) => oid(100 + i));
  assert.equal((await print(fifty.join(','))).status, 200);
  assert.equal((await print([...fifty, ...fifty.slice(0, 10)].join(','))).status, 200);
});

test('print: duplicates are dropped and the requested order is kept', async () => {
  const [a, b, c] = [seed(1), seed(2), seed(3)];
  const { status, body } = await print([c, a, c, b, a.toUpperCase()].join(','));
  assert.equal(status, 200);
  assert.deepEqual(body.orders.map((o: any) => o.id), [c, a, b]);
  assert.deepEqual(body.skipped, []);
});

test('print: cancelled, returned and unknown ids are skipped, in order, and the rest still print', async () => {
  const good = seed(1);
  const cancelled = seed(2, { status: 'cancelled' });
  const returned = seed(3, { status: 'returned' });
  const unknown = oid(9);
  const { status, body } = await print([cancelled, good, unknown, returned].join(','));
  assert.equal(status, 200);
  assert.deepEqual(body.orders.map((o: any) => o.id), [good]);
  assert.deepEqual(body.skipped, [
    { id: cancelled, reason: 'cancelled' },
    { id: unknown, reason: 'not_found' },
    { id: returned, reason: 'returned' },
  ]);
});

test('print: every status before cancelled or returned is printable', async () => {
  const ids = ['pending', 'confirmed', 'processing', 'dispatched', 'delivered'].map((status, i) => seed(i + 1, { status }));
  const { body } = await print(ids.join(','));
  assert.equal(body.orders.length, 5);
  assert.deepEqual(body.skipped, []);
});

test('print: the sheet has exactly the agreed fields, is contract-valid and never cached', async () => {
  const id = seed(1);
  const { status, body, headers } = await print(id);
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(orderPrintResponseSchema.safeParse(body).success, true);
  assert.deepEqual(Object.keys(body).sort(), ['orders', 'skipped', 'store']);
  assert.deepEqual(body.store, { name: 'Sara Boutique' });
  assert.deepEqual(Object.keys(body.orders[0]).sort(), [
    'address', 'city', 'codAmount', 'courier', 'createdAt', 'customerName', 'id', 'items', 'orderId', 'paymentMethod',
    'paymentStatus', 'phone', 'status', 'trackingNumber',
  ]);
  assert.deepEqual(body.orders[0].items, [{ title: 'Shirt', variantTitle: 'Red / M', sku: 'SH-RM', qty: 2 }]);
});

test('print: a Default variant, a missing courier and a missing city read as null', async () => {
  const id = seed(1, {
    status: 'confirmed',
    courier: null,
    trackingNumber: undefined,
    city: undefined,
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Mug', variantTitle: 'Default', unitPrice: 400, quantity: 1 }],
  });
  const { body } = await print(id);
  assert.deepEqual(body.orders[0].items, [{ title: 'Mug', variantTitle: null, sku: null, qty: 1 }]);
  assert.equal(body.orders[0].courier, null);
  assert.equal(body.orders[0].trackingNumber, null);
  assert.equal(body.orders[0].city, null);
});

test('print: the COD amount is the total when unpaid, and 0 when collected, prepaid or without a method', async () => {
  const unpaid = seed(1);
  const collected = seed(2, { paymentStatus: 'collected' });
  const card = seed(3, { paymentMethod: 'card' });
  const none = seed(4, { paymentMethod: undefined });
  const old = seed(5, { paymentStatus: undefined, total: 19.999 });
  const { body } = await print([unpaid, collected, card, none, old].join(','));
  assert.deepEqual(body.orders.map((o: any) => o.codAmount), [2500, 0, 0, 0, 20]);
  assert.equal(body.orders[3].paymentMethod, null);
  assert.equal(body.orders[4].paymentStatus, 'unpaid');
});

test('print: long names and addresses, emoji and Urdu text come back whole and unmodified', async () => {
  const name = 'محمد بلال ' + 'ن'.repeat(220) + ' 🎉👩🏽‍💻';
  const address = '  House 12, گلی نمبر 4, ' + 'Block 5 '.repeat(60) + '🏠  ';
  const title = 'لان کا سوٹ ' + 'x'.repeat(250);
  const id = seed(1, {
    customerName: name,
    address,
    items: [{ productId: 'p1', variantId: 'v1', productTitle: title, variantTitle: 'Default', unitPrice: 1, quantity: 1 }],
  });
  const { body } = await print(id);
  assert.equal(body.orders[0].customerName, name);
  assert.equal(body.orders[0].address, address);
  assert.equal(body.orders[0].items[0].title, title);
});

test('print: notes, history and idempotency data are neither loaded nor returned', async () => {
  const id = seed(1);
  const { text } = await print(id);
  for (const secret of ['SECRET-NOTE', 'SECRET-HISTORY', 'statusHistory', 'notes', 'timeline', 'idempotencyKey', 'requestFingerprint', 'idem-key-1', 'fp-1']) {
    assert.equal(text.includes(secret), false, secret);
  }
  for (const field of ['notes', 'statusHistory', 'idempotencyKey', 'requestFingerprint']) {
    assert.equal(selected.split(' ').includes(field), false, field);
  }
});
