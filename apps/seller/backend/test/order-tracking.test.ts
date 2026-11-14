import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { AuditLog, Order, Product, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';

// EP-02 OB-4: POST /api/orders/:id/tracking (seller) and POST /api/storefront/v1/stores/:id/orders/track (customer).
// Models are stubbed; no database.

const { orderTrackingResponseSchema, storefrontOrderTrackingResponseSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const ORDER_A = '65a0000000000000000a0001';
const ORDER_B = '65a0000000000000000a0002';
const PHONE = '+923001234567';

const OrderModel = Order as any;
const StoreModel = Store as any;
const ProductModel = Product as any;
const AuditModel = AuditLog as any;

const stores = [
  { _id: STORE_A, owner: USER_A, status: 'active' },
  { _id: STORE_B, owner: USER_B, status: 'active' },
];

let orders: Array<Record<string, any>> = [];
let audits: Array<Record<string, any>> = [];
let auditFails = false;
let writes = 0;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let trackingPOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let trackPOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let lookupPOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  trackingPOST = (await import('../src/app/api/orders/[id]/tracking/route')).POST;
  trackPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/track/route')).POST;
  lookupPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/lookup/route')).POST;
});

// ---------------------------------------------------------------------------------------------------------------------
// Stubs

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
}

const copy = (row: Record<string, any>): Record<string, any> => ({ ...row, statusHistory: [...(row.statusHistory ?? [])] });

let afterRead: (() => void) | null = null;
let restore: (() => void) | null = null;

beforeEach(() => {
  resetRateLimits();
  const saved = {
    connect: (mongoose as any).connect,
    oFindOne: OrderModel.findOne,
    oFOAU: OrderModel.findOneAndUpdate,
    sExists: StoreModel.exists,
    sFindOne: StoreModel.findOne,
    sFindById: StoreModel.findById,
    product: Object.fromEntries(['find', 'findOne', 'findOneAndUpdate', 'exists'].map((m) => [m, ProductModel[m]])),
    aCreate: AuditModel.create,
  };
  orders = [];
  audits = [];
  auditFails = false;
  writes = 0;
  afterRead = null;

  (mongoose as any).connect = async () => mongoose;
  OrderModel.findOne = (filter: any) => {
    const q: any = {
      select: () => q,
      lean: async () => {
        const found = orders.find((row) => matches(row, filter));
        const snapshot = found ? copy(found) : null;
        if (afterRead) {
          const hook = afterRead;
          afterRead = null;
          hook();
        }
        return snapshot;
      },
    };
    return q;
  };
  OrderModel.findOneAndUpdate = (filter: any, update: any, options: any) => ({
    lean: async () => {
      assert.equal(options?.new, true);
      const row = orders.find((r) => matches(r, filter));
      if (!row) return null;
      writes += 1;
      Object.assign(row, update.$set ?? {});
      for (const [key, value] of Object.entries(update.$push ?? {})) row[key] = [...(row[key] ?? []), value];
      return copy(row);
    },
  });
  StoreModel.exists = async (filter: any) => (stores.some((s) => matches(s, { _id: filter._id, owner: filter.owner })) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => {
    const q: any = { sort: () => q, select: () => q, lean: async () => stores.find((s) => matches(s, filter)) ?? null };
    return q;
  };
  StoreModel.findById = (id: string) => {
    const q: any = { select: () => q, lean: async () => stores.find((s) => s._id === String(id)) ?? null };
    return q;
  };
  for (const method of Object.keys(saved.product)) {
    ProductModel[method] = () => {
      throw new Error('tracking must not touch products');
    };
  }
  AuditModel.create = async (doc: Record<string, any>) => {
    if (auditFails) throw new Error('audit store down');
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };

  restore = () => {
    (mongoose as any).connect = saved.connect;
    OrderModel.findOne = saved.oFindOne;
    OrderModel.findOneAndUpdate = saved.oFOAU;
    StoreModel.exists = saved.sExists;
    StoreModel.findOne = saved.sFindOne;
    StoreModel.findById = saved.sFindById;
    for (const [method, fn] of Object.entries(saved.product)) ProductModel[method] = fn;
    AuditModel.create = saved.aCreate;
  };
});

afterEach(() => {
  restore?.();
  restore = null;
});

function seedOrder(status: string, fields: Record<string, any> = {}): Record<string, any> {
  const row = {
    _id: ORDER_A,
    store: STORE_A,
    orderId: 'ORD-ABCD2345',
    status,
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    customerName: 'Sara Khan',
    phone: PHONE,
    address: 'House 12, Street 4, Block 5',
    city: 'Karachi',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 2, stockDeducted: true }],
    subtotal: 2400,
    deliveryCharges: 0,
    total: 2400,
    notes: [{ text: 'Secret seller note', by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-02T00:00:00Z') }],
    cancelReason: null,
    idempotencyKey: 'idem-key-1',
    requestFingerprint: 'fp-1',
    courier: status === 'dispatched' || status === 'delivered' ? 'TCS' : null,
    trackingNumber: status === 'dispatched' || status === 'delivered' ? 'TCS-1001' : null,
    trackingUrl: null,
    statusHistory: [],
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...fields,
  };
  orders.push(row);
  return row;
}

const stored = (id = ORDER_A) => orders.find((row) => String(row._id) === id)!;

function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = original;
  });
}

function sellerPost(id: string, body: unknown, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  return trackingPOST(
    new NextRequest('http://seller.test/api/orders/' + id + '/tracking', { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

async function edit(body: unknown, id = ORDER_A, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const res = await sellerPost(id, body, token, headers);
  return { status: res.status, body: (await res.json()) as any };
}

function shopperPost(handler: typeof trackPOST, storeId: string, body: unknown, ip = '203.0.113.7') {
  return handler(
    new NextRequest('http://seller.test/api/storefront/v1/stores/' + storeId + '/orders/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: storeId }) },
  );
}

async function track(body: unknown, storeId = STORE_A, ip?: string) {
  const res = await shopperPost(trackPOST, storeId, body, ip);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}

// =====================================================================================================================
// Seller: editing tracking after dispatch

test('tracking edit: no login 401; admin 403 whatever the body; seller B on store A 403; other store or bad id 404', async () => {
  seedOrder('dispatched');
  seedOrder('dispatched', { _id: ORDER_B, store: STORE_B });
  assert.equal((await sellerPost(ORDER_A, { trackingNumber: 'X1' }, null)).status, 401);
  assert.equal((await sellerPost(ORDER_A, { trackingNumber: 'X1' }, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await sellerPost(ORDER_A, {}, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await sellerPost(ORDER_A, { trackingNumber: 'X1' }, tokenB, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await sellerPost(ORDER_B, { trackingNumber: 'X1' })).status, 404);
  assert.equal((await sellerPost('not-an-id', { trackingNumber: 'X1' })).status, 404);
  assert.equal(stored().trackingNumber, 'TCS-1001');
  assert.equal(writes, 0);
});

test('tracking edit: changes the sent fields and adds one history entry naming them', async () => {
  seedOrder('dispatched');
  const before = Date.now();
  const { status, body } = await edit({ courier: ' Leopards ', trackingNumber: ' LP-77 ', trackingUrl: 'https://leopards.test/LP-77' });
  assert.equal(status, 200);
  assert.equal(orderTrackingResponseSchema.safeParse(body).success, true);
  assert.equal(body.changed, true);
  assert.equal(stored().courier, 'Leopards');
  assert.equal(stored().trackingNumber, 'LP-77');
  assert.equal(stored().trackingUrl, 'https://leopards.test/LP-77');
  assert.equal(stored().status, 'dispatched');
  assert.equal(stored().statusHistory.length, 1);
  const entry = stored().statusHistory[0];
  assert.equal(entry.from, 'dispatched');
  assert.equal(entry.to, 'dispatched');
  assert.ok(entry.by instanceof mongoose.Types.ObjectId);
  assert.equal(String(entry.by), USER_A);
  assert.ok(entry.at.getTime() >= before);
  assert.equal(entry.note, 'Tracking updated: courier, tracking number, tracking link');
  assert.equal(body.order.canEditTracking, true);
  assert.equal(body.order.trackingNumber, 'LP-77');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'order.tracking');
  assert.equal(audits[0].actorId, 'seller:' + USER_A);
});

test('tracking edit: only the fields that really change are written and named; null clears the link', async () => {
  seedOrder('dispatched', { trackingUrl: 'https://tcs.test/1' });
  const { body } = await edit({ courier: 'TCS', trackingUrl: null });
  assert.equal(body.changed, true);
  assert.equal(stored().trackingUrl, null);
  assert.equal(stored().statusHistory[0].note, 'Tracking updated: tracking link');
});

test('tracking edit: sending the stored values is a 200 no-op with no write and no history entry', async () => {
  seedOrder('dispatched');
  const { status, body } = await edit({ courier: 'TCS', trackingNumber: 'TCS-1001', trackingUrl: null });
  assert.equal(status, 200);
  assert.equal(body.changed, false);
  assert.equal(writes, 0);
  assert.equal(stored().statusHistory.length, 0);
  assert.equal(audits.length, 0);
});

test('tracking edit: allowed only while dispatched; any other status is 422 ORDER_TRACKING_ILLEGAL', async () => {
  for (const status of ['pending', 'confirmed', 'processing', 'delivered', 'cancelled', 'returned']) {
    orders = [];
    seedOrder(status);
    const res = await edit({ trackingNumber: 'NEW-1' });
    assert.equal(res.status, 422, status);
    assert.equal(res.body.errors[0].code, 'ORDER_TRACKING_ILLEGAL');
    assert.equal(res.body.errors[0].status, status);
  }
  assert.equal(writes, 0);
});

test('tracking edit: bad bodies are 400 ORDER_BODY_INVALID with the field named', async () => {
  seedOrder('dispatched');
  const cases: Array<[unknown, string | null]> = [
    [{}, null],
    [{ store: STORE_B }, null],
    [{ courier: 'X' }, 'courier'],
    [{ courier: 'x'.repeat(41) }, 'courier'],
    [{ trackingNumber: '' }, 'trackingNumber'],
    [{ trackingNumber: 'x'.repeat(61) }, 'trackingNumber'],
    [{ trackingUrl: 'ftp://tcs.test/1' }, 'trackingUrl'],
    [{ trackingUrl: 'javascript:alert(1)' }, 'trackingUrl'],
    ['not json', null],
  ];
  for (const [body, field] of cases) {
    const res = await edit(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.errors[0].code, 'ORDER_BODY_INVALID');
    assert.equal(res.body.errors[0].field, field, JSON.stringify(body));
  }
  assert.equal(writes, 0);
});

test('tracking edit: unknown keys are dropped; status and history cannot be set through it', async () => {
  seedOrder('dispatched');
  const res = await edit({ trackingNumber: 'NEW-1', status: 'delivered', statusHistory: [], store: STORE_B });
  assert.equal(res.status, 200);
  assert.equal(stored().status, 'dispatched');
  assert.equal(stored().store, STORE_A);
  assert.equal(stored().statusHistory.length, 1);
});

test('tracking edit: a status change that lands between the read and the write gives 409', async () => {
  seedOrder('dispatched');
  afterRead = () => {
    stored().status = 'delivered';
  };
  const res = await edit({ trackingNumber: 'NEW-1' });
  assert.equal(res.status, 409);
  assert.equal(res.body.errors[0].code, 'ORDER_STATUS_CHANGED');
  assert.equal(res.body.errors[0].status, 'delivered');
  assert.equal(stored().trackingNumber, 'TCS-1001');
  assert.equal(writes, 0);
});

test('tracking edit: a failing audit write does not fail the request', async () => {
  seedOrder('dispatched');
  auditFails = true;
  const res = await quietly(() => edit({ trackingNumber: 'NEW-1' }));
  assert.equal(res.status, 200);
  assert.equal(stored().trackingNumber, 'NEW-1');
});

test('detail: canEditTracking is true only while dispatched', async () => {
  const detailGET = (await import('../src/app/api/orders/[id]/route')).GET;
  for (const status of ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned']) {
    orders = [];
    seedOrder(status);
    const res = await detailGET(new NextRequest('http://seller.test/api/orders/' + ORDER_A, { headers: { authorization: 'Bearer ' + tokenA } }), {
      params: Promise.resolve({ id: ORDER_A }),
    });
    const body = (await res.json()) as any;
    assert.equal(body.canEditTracking, status === 'dispatched', status);
  }
});

// =====================================================================================================================
// Customer tracking

const ALLOWED_KEYS = ['courier', 'createdAt', 'dates', 'orderId', 'status', 'trackingNumber', 'trackingUrl'];

test('customer tracking: the right order and phone give 200 with exactly the allowed keys and nothing private', async () => {
  seedOrder('dispatched', {
    trackingUrl: 'https://tcs.test/TCS-1001',
    statusHistory: [
      { from: 'pending', to: 'confirmed', by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-02T09:00:00Z'), note: 'internal' },
      { from: 'confirmed', to: 'processing', by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-02T12:00:00Z'), note: null },
      { from: 'processing', to: 'dispatched', by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-03T08:00:00Z'), note: null },
    ],
  });
  const { status, body, text } = await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' });
  assert.equal(status, 200);
  assert.equal(storefrontOrderTrackingResponseSchema.safeParse(body).success, true);
  assert.deepEqual(Object.keys(body), ['data']);
  assert.deepEqual(Object.keys(body.data).sort(), ALLOWED_KEYS);
  assert.equal(body.data.status, 'dispatched');
  assert.equal(body.data.courier, 'TCS');
  assert.equal(body.data.trackingNumber, 'TCS-1001');
  assert.equal(body.data.trackingUrl, 'https://tcs.test/TCS-1001');
  assert.deepEqual(body.data.dates, {
    pending: '2026-11-01T10:00:00.000Z',
    confirmed: '2026-11-02T09:00:00.000Z',
    processing: '2026-11-02T12:00:00.000Z',
    dispatched: '2026-11-03T08:00:00.000Z',
    delivered: null,
    cancelled: null,
    returned: null,
  });
  for (const secret of ['Sara Khan', PHONE, 'House 12', 'Karachi', 'Shirt', '2400', 'Secret seller note', 'internal', 'idem-key-1', 'fp-1', ORDER_A, STORE_A, USER_A, 'unpaid', 'cod']) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test('customer tracking: a wrong phone, an unknown order and another store give the same 404 body', async () => {
  seedOrder('confirmed');
  seedOrder('confirmed', { _id: ORDER_B, store: STORE_B, orderId: 'ORD-OTHER777' });
  const wrongPhone = await track({ orderId: 'ORD-ABCD2345', phone: '0311 1111111' });
  const unknown = await track({ orderId: 'ORD-NOPE0000', phone: '0300 1234567' });
  const otherStore = await track({ orderId: 'ORD-OTHER777', phone: '0300 1234567' });
  for (const res of [wrongPhone, unknown, otherStore]) {
    assert.equal(res.status, 404);
    assert.equal(res.text, wrongPhone.text);
  }
  assert.equal(wrongPhone.body.error.code, 'ORDER_NOT_FOUND');
});

test('customer tracking: 0300..., +92300... and a lower-case reference all match; a stored local phone matches too', async () => {
  seedOrder('confirmed');
  for (const phone of ['0300 1234567', '03001234567', '+923001234567', '+92 300 1234567']) {
    assert.equal((await track({ orderId: 'ORD-ABCD2345', phone })).status, 200, phone);
  }
  assert.equal((await track({ orderId: 'abcd2345', phone: '0300 1234567' })).status, 200);
  orders = [];
  seedOrder('confirmed', { phone: '03001234567' });
  assert.equal((await track({ orderId: 'ORD-ABCD2345', phone: '+923001234567' })).status, 200);
});

test('customer tracking: a cancelled order shows its status only: no dates, no courier', async () => {
  seedOrder('cancelled', {
    cancelReason: 'Customer asked to cancel',
    cancelledAt: new Date('2026-11-02T10:00:00Z'),
    courier: 'TCS',
    trackingNumber: 'TCS-1',
    statusHistory: [{ from: 'pending', to: 'cancelled', by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-02T10:00:00Z'), note: null }],
  });
  const { status, body, text } = await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' });
  assert.equal(status, 200);
  assert.equal(body.data.status, 'cancelled');
  assert.ok(Object.values(body.data.dates).every((value) => value === null));
  assert.equal(body.data.courier, null);
  assert.equal(body.data.trackingNumber, null);
  assert.equal(text.includes('Customer asked to cancel'), false);
});

test('customer tracking: courier and tracking appear only while dispatched or delivered', async () => {
  seedOrder('processing', { courier: 'TCS', trackingNumber: 'EARLY-1' });
  const early = await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' });
  assert.equal(early.body.data.courier, null);
  assert.equal(early.body.data.trackingNumber, null);
  orders = [];
  seedOrder('delivered');
  const done = await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' });
  assert.equal(done.body.data.courier, 'TCS');
});

test('customer tracking: dates use the first time a status was reached; an old order without history has pending only', async () => {
  seedOrder('dispatched', {
    statusHistory: [
      { from: 'processing', to: 'dispatched', at: new Date('2026-11-03T08:00:00Z') },
      { from: 'dispatched', to: 'dispatched', at: new Date('2026-11-04T08:00:00Z'), note: 'Tracking updated: tracking number' },
    ],
  });
  const withHistory = await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' });
  assert.equal(withHistory.body.data.dates.dispatched, '2026-11-03T08:00:00.000Z');
  orders = [];
  seedOrder('confirmed', { statusHistory: undefined });
  const old = await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' });
  assert.deepEqual(old.body.data.dates, {
    pending: '2026-11-01T10:00:00.000Z', confirmed: null, processing: null, dispatched: null, delivered: null, cancelled: null, returned: null,
  });
});

test('customer tracking: rate limited per client and store, sharing the lookup bucket', async () => {
  seedOrder('confirmed');
  const ip = '198.51.100.20';
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await track({ orderId: 'ORD-NOPE0000', phone: '0300 1234567' }, STORE_A, ip)).status, 404, String(i));
  }
  const limited = await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' }, STORE_A, ip);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  // The order lookup counts against the same window.
  const lookup = await shopperPost(lookupPOST, STORE_A, { orderId: 'ORD-ABCD2345', phone: '0300 1234567' }, ip);
  assert.equal(lookup.status, 429);
  // Another client is not affected.
  assert.equal((await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' }, STORE_A, '198.51.100.21')).status, 200);
});

test('customer tracking: a malformed phone is 400 and an unknown store is 404', async () => {
  seedOrder('confirmed');
  assert.equal((await track({ orderId: 'ORD-ABCD2345', phone: '12' })).status, 400);
  assert.equal((await track({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' }, '65a000000000000000000099')).status, 404);
});
