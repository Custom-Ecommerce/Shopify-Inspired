import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { AuditLog, Order, Product, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';

// EP-02 OB-5a: POST /api/orders/:id/payment, POST /api/orders/:id/notes and the timeline. Models are stubbed; no database.

const { dashboardOrderDetailSchema, orderNoteResponseSchema, orderPaymentResponseSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const ORDER_A = '65a0000000000000000a0001';
const ORDER_B = '65a0000000000000000a0002';

const OrderModel = Order as any;
const StoreModel = Store as any;
const ProductModel = Product as any;
const AuditModel = AuditLog as any;

const stores = [
  { _id: STORE_A, owner: USER_A, status: 'active' },
  { _id: STORE_B, owner: USER_B, status: 'active' },
];

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

let orders: Array<Record<string, any>> = [];
let audits: Array<Record<string, any>> = [];
let auditFails = false;
let writes = 0;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let paymentPOST: Handler;
let notesPOST: Handler;
let detailGET: Handler;
let trackPOST: Handler;
let lookupPOST: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  paymentPOST = (await import('../src/app/api/orders/[id]/payment/route')).POST;
  notesPOST = (await import('../src/app/api/orders/[id]/notes/route')).POST;
  detailGET = (await import('../src/app/api/orders/[id]/route')).GET;
  trackPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/track/route')).POST;
  lookupPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/lookup/route')).POST;
});

// ---------------------------------------------------------------------------------------------------------------------
// Stubs. findOneAndUpdate matches and writes in one synchronous step, as MongoDB does for one document.

function fieldMatches(row: Record<string, any>, key: string, condition: any): boolean {
  if (key === 'notes.99') return (row.notes?.[99] !== undefined) === Boolean(condition.$exists);
  if (condition !== null && typeof condition === 'object' && !(condition instanceof mongoose.Types.ObjectId)) {
    if ('$in' in condition) return condition.$in.includes(row[key]);
    if ('$ne' in condition) return row[key] !== condition.$ne;
  }
  return String(row[key]) === String(condition);
}

const matches = (row: Record<string, any>, filter: Record<string, any>): boolean =>
  Object.entries(filter).every(([key, condition]) => fieldMatches(row, key, condition));

const copy = (row: Record<string, any>): Record<string, any> => ({ ...row, statusHistory: [...(row.statusHistory ?? [])], notes: [...(row.notes ?? [])] });

interface ReadGate {
  expected: number;
  arrived: number;
  release: () => void;
  released: Promise<void>;
  onAllArrived?: () => void;
}
let gate: ReadGate | null = null;

function holdReads(expected: number, onAllArrived?: () => void): void {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  gate = { expected, arrived: 0, release, released, onAllArrived };
}

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
    product: Object.fromEntries(['find', 'findOne', 'findOneAndUpdate', 'exists', 'updateOne'].map((m) => [m, ProductModel[m]])),
    aCreate: AuditModel.create,
  };
  orders = [];
  audits = [];
  auditFails = false;
  writes = 0;
  gate = null;

  (mongoose as any).connect = async () => mongoose;
  OrderModel.findOne = (filter: any) => {
    const q: any = {
      select: () => q,
      lean: async () => {
        const found = orders.find((row) => matches(row, filter));
        const snapshot = found ? copy(found) : null;
        if (gate && gate.arrived < gate.expected) {
          gate.arrived += 1;
          if (gate.arrived === gate.expected) {
            gate.onAllArrived?.();
            gate.release();
          }
          await gate.released;
        }
        return snapshot;
      },
    };
    return q;
  };
  OrderModel.findOneAndUpdate = (filter: any, update: any, options: any) => ({
    lean: async () => {
      assert.equal(options?.new, true);
      assert.equal(options?.runValidators, true);
      const row = orders.find((r) => matches(r, filter));
      if (!row) return null;
      writes += 1;
      Object.assign(row, update.$set ?? {});
      for (const [key, value] of Object.entries(update.$push ?? {})) row[key] = [...(row[key] ?? []), value];
      return copy(row);
    },
  });
  StoreModel.exists = async (filter: any) => (stores.some((s) => s._id === String(filter._id) && s.owner === String(filter.owner)) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => {
    const q: any = { sort: () => q, select: () => q, lean: async () => stores.find((s) => s.owner === String(filter.owner)) ?? null };
    return q;
  };
  StoreModel.findById = (id: string) => {
    const q: any = { select: () => q, lean: async () => stores.find((s) => s._id === String(id)) ?? null };
    return q;
  };
  for (const method of Object.keys(saved.product)) {
    ProductModel[method] = () => {
      throw new Error('payment and notes must not touch products');
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
    collectedAt: null,
    collectedAmount: null,
    customerName: 'Sara Khan',
    phone: '+923001234567',
    address: 'House 12, Street 4, Block 5',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 2 }],
    subtotal: 2400,
    deliveryCharges: 100,
    total: 2500,
    statusHistory: [],
    notes: [],
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

function send(handler: Handler, path: string, id: string, body: unknown, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  return handler(
    new NextRequest('http://seller.test/api/orders/' + id + path, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

async function pay(body: unknown = {}, id = ORDER_A, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const res = await send(paymentPOST, '/payment', id, body, token, headers);
  return { status: res.status, body: (await res.json()) as any };
}

async function note(body: unknown, id = ORDER_A, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const res = await send(notesPOST, '/notes', id, body, token, headers);
  return { status: res.status, body: (await res.json()) as any };
}

async function detail(id = ORDER_A) {
  const res = await detailGET(new NextRequest('http://seller.test/api/orders/' + id, { headers: { authorization: 'Bearer ' + tokenA } }), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

// =====================================================================================================================
// Payment

test('payment: no login 401; admin 403 whatever the body; seller B on store A 403; other store or bad id 404', async () => {
  seedOrder('dispatched');
  seedOrder('dispatched', { _id: ORDER_B, store: STORE_B });
  assert.equal((await pay({}, ORDER_A, null)).status, 401);
  assert.equal((await pay({}, ORDER_A, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await pay({ amount: -1 }, ORDER_A, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await pay({}, ORDER_A, tokenB, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await pay({}, ORDER_B)).status, 404);
  assert.equal((await pay({}, 'not-an-id')).status, 404);
  assert.equal(writes, 0);
  assert.equal(stored().paymentStatus, 'unpaid');
});

test('payment: a dispatched or a delivered order can be collected; one history entry and one audit entry', async () => {
  for (const status of ['dispatched', 'delivered']) {
    orders = [];
    audits = [];
    seedOrder(status);
    const before = Date.now();
    const res = await pay({ amount: 2500 });
    assert.equal(res.status, 200, status);
    assert.equal(orderPaymentResponseSchema.safeParse(res.body).success, true);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.order.paymentStatus, 'collected');
    assert.equal(res.body.order.collectedAmount, 2500);
    assert.equal(res.body.order.canMarkCollected, false);
    const row = stored();
    assert.equal(row.paymentStatus, 'collected');
    assert.equal(row.collectedAmount, 2500);
    assert.ok(row.collectedAt instanceof Date && row.collectedAt.getTime() >= before);
    assert.equal(row.status, status, 'the status does not move');
    assert.equal(row.statusHistory.length, 1);
    const entry = row.statusHistory[0];
    assert.equal(entry.from, status);
    assert.equal(entry.to, status);
    assert.ok(entry.by instanceof mongoose.Types.ObjectId);
    assert.equal(String(entry.by), USER_A);
    assert.equal(entry.note, 'COD collected: Rs. 2,500');
    assert.equal(entry.kind, 'payment');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'order.payment');
    assert.equal(audits[0].actorId, 'seller:' + USER_A);
    assert.equal(audits[0].details.amount, 2500);
  }
});

test('payment: leaving the amount out means the order total', async () => {
  seedOrder('delivered');
  const res = await pay({});
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, true);
  assert.equal(stored().collectedAmount, 2500);
});

test('payment: an order written before paymentStatus existed can be collected', async () => {
  const row = seedOrder('delivered');
  delete row.paymentStatus;
  assert.equal((await detail()).body.canMarkCollected, true);
  assert.equal((await pay({})).status, 200);
  assert.equal(stored().paymentStatus, 'collected');
});

test('payment: before dispatch is 422 before_dispatch; a closed order is 422 order_closed', async () => {
  for (const [status, reason] of [
    ['pending', 'before_dispatch'],
    ['confirmed', 'before_dispatch'],
    ['processing', 'before_dispatch'],
    ['cancelled', 'order_closed'],
    ['returned', 'order_closed'],
  ]) {
    orders = [];
    seedOrder(status);
    const res = await pay({});
    assert.equal(res.status, 422, status);
    assert.equal(res.body.errors[0].code, 'PAYMENT_NOT_ALLOWED');
    assert.equal(res.body.errors[0].status, status);
    assert.equal(res.body.errors[0].reason, reason);
    assert.equal(stored().paymentStatus, 'unpaid');
  }
  assert.equal(writes, 0);
});

test('payment: only COD; a card order, paid or not, or one with no method is 422 PAYMENT_NOT_COD', async () => {
  for (const [paymentMethod, paymentStatus] of [['card', 'unpaid'], ['card', 'paid'], [undefined, undefined]]) {
    orders = [];
    seedOrder('delivered', { paymentMethod, paymentStatus });
    const res = await pay({});
    assert.equal(res.status, 422, String(paymentMethod));
    assert.equal(res.body.errors[0].code, 'PAYMENT_NOT_COD');
    assert.equal((await detail()).body.canMarkCollected, false);
  }
  assert.equal(writes, 0);
});

test('payment: an amount other than the total is 422 PAYMENT_AMOUNT_MISMATCH with the expected amount', async () => {
  seedOrder('dispatched');
  for (const amount of [2499, 2500.01, 1250]) {
    const res = await pay({ amount });
    assert.equal(res.status, 422, String(amount));
    assert.equal(res.body.errors[0].code, 'PAYMENT_AMOUNT_MISMATCH');
    assert.equal(res.body.errors[0].expected, 2500);
  }
  assert.equal(writes, 0);
  orders = [];
  seedOrder('dispatched', { total: 19.99 });
  assert.equal((await pay({ amount: 19.99 })).status, 200);
});

test('payment: bad bodies are 400 ORDER_BODY_INVALID; unknown keys are dropped', async () => {
  seedOrder('dispatched');
  for (const body of [{ amount: 0 }, { amount: -5 }, { amount: 1.234 }, { amount: '2500' }, { amount: null }]) {
    const res = await pay(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.errors[0].code, 'ORDER_BODY_INVALID');
    assert.equal(res.body.errors[0].field, 'amount');
  }
  const notJson = await pay('not json');
  assert.equal(notJson.status, 400);
  assert.equal(notJson.body.errors[0].field, null);
  assert.equal(writes, 0);
  const res = await pay({ paymentStatus: 'unpaid', collectedAmount: 1, status: 'pending' });
  assert.equal(res.status, 200);
  assert.equal(stored().collectedAmount, 2500);
  assert.equal(stored().status, 'dispatched');
});

test('payment: a repeat call is a 200 no-op: no write, no second history entry, no audit', async () => {
  seedOrder('delivered');
  assert.equal((await pay({})).body.changed, true);
  audits = [];
  const before = writes;
  for (const body of [{}, { amount: 2500 }]) {
    const res = await pay(body);
    assert.equal(res.status, 200);
    assert.equal(res.body.changed, false);
    assert.equal(res.body.order.paymentStatus, 'collected');
  }
  assert.equal(writes, before);
  assert.equal(stored().statusHistory.length, 1);
  assert.equal(audits.length, 0);
});

test('payment: two parallel collects: both 200, one changed, one history entry', async () => {
  seedOrder('dispatched');
  holdReads(2);
  const results = await Promise.all([pay({}), pay({})]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.deepEqual(results.map((r) => r.body.changed).sort(), [false, true]);
  assert.equal(writes, 1);
  assert.equal(stored().statusHistory.length, 1);
  assert.equal(audits.length, 1);
});

test('payment: a status change landing between the read and the write gives 409', async () => {
  seedOrder('dispatched');
  holdReads(1, () => {
    stored().status = 'returned';
  });
  const res = await pay({});
  assert.equal(res.status, 409);
  assert.equal(res.body.errors[0].code, 'ORDER_STATUS_CHANGED');
  assert.equal(res.body.errors[0].status, 'returned');
  assert.equal(stored().paymentStatus, 'unpaid');
  assert.equal(writes, 0);
});

test('payment: a dispatched order delivered between the read and the write is still collected', async () => {
  seedOrder('dispatched');
  holdReads(1, () => {
    stored().status = 'delivered';
  });
  const res = await pay({});
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, true);
  assert.equal(stored().paymentStatus, 'collected');
});

test('payment: a failing audit write does not fail the request', async () => {
  seedOrder('dispatched');
  auditFails = true;
  const res = await quietly(() => pay({}));
  assert.equal(res.status, 200);
  assert.equal(stored().paymentStatus, 'collected');
});

test('detail: canMarkCollected follows COD, unpaid and dispatched or delivered', async () => {
  for (const [status, expected] of [
    ['pending', false],
    ['processing', false],
    ['dispatched', true],
    ['delivered', true],
    ['cancelled', false],
  ] as const) {
    orders = [];
    seedOrder(status);
    assert.equal((await detail()).body.canMarkCollected, expected, status);
  }
  orders = [];
  seedOrder('delivered', { paymentStatus: 'collected' });
  assert.equal((await detail()).body.canMarkCollected, false);
});

// =====================================================================================================================
// Notes

test('notes: no login 401; admin 403 whatever the body; seller B on store A 403; other store or bad id 404', async () => {
  seedOrder('pending');
  seedOrder('pending', { _id: ORDER_B, store: STORE_B });
  assert.equal((await note({ text: 'a' }, ORDER_A, null)).status, 401);
  assert.equal((await note({ text: 'a' }, ORDER_A, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await note({}, ORDER_A, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await note({ text: 'a' }, ORDER_A, tokenB, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await note({ text: 'a' }, ORDER_B)).status, 404);
  assert.equal((await note({ text: 'a' }, 'not-an-id')).status, 404);
  assert.equal(writes, 0);
});

test('notes: adds a trimmed note with the user and time; the audit records its length, never its text', async () => {
  seedOrder('confirmed');
  const before = Date.now();
  const res = await note({ text: '  Call before delivery  ' });
  assert.equal(res.status, 200);
  assert.equal(orderNoteResponseSchema.safeParse(res.body).success, true);
  assert.equal(stored().notes.length, 1);
  const entry = stored().notes[0];
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'by', 'text']);
  assert.equal(entry.text, 'Call before delivery');
  assert.equal(String(entry.by), USER_A);
  assert.ok(entry.at.getTime() >= before);
  assert.equal(res.body.order.notes[0].text, 'Call before delivery');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'order.note');
  assert.equal(audits[0].details.length, 'Call before delivery'.length);
  assert.equal(JSON.stringify(audits[0]).includes('Call before'), false);
});

test('notes: a note can be added whatever the order status', async () => {
  for (const status of ['pending', 'delivered', 'cancelled', 'returned']) {
    orders = [];
    seedOrder(status);
    assert.equal((await note({ text: 'x' })).status, 200, status);
  }
});

test('notes: empty or long text is 400; unknown keys are dropped', async () => {
  seedOrder('pending');
  for (const body of [{}, { text: '' }, { text: '   ' }, { text: 'x'.repeat(501) }, { text: 5 }]) {
    const res = await note(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.errors[0].code, 'ORDER_BODY_INVALID');
    assert.equal(res.body.errors[0].field, 'text');
  }
  assert.equal(writes, 0);
  assert.equal((await note({ text: 'x'.repeat(500) })).status, 200);
  const res = await note({ text: 'ok', by: USER_B, at: '2020-01-01', status: 'delivered' });
  assert.equal(res.status, 200);
  assert.equal(String(stored().notes[1].by), USER_A);
  assert.equal(stored().status, 'pending');
});

const notesOf = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ text: 'n' + i, by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-02T00:00:00Z') }));

test('notes: at most 100; the 100th is accepted and the next is 422 ORDER_NOTES_FULL', async () => {
  seedOrder('pending', { notes: notesOf(99) });
  assert.equal((await note({ text: 'the hundredth' })).status, 200);
  assert.equal(stored().notes.length, 100);
  const res = await note({ text: 'one too many' });
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'ORDER_NOTES_FULL');
  assert.equal(stored().notes.length, 100);
});

test('notes: the cap holds for parallel requests, because it is inside the write', async () => {
  seedOrder('pending', { notes: notesOf(99) });
  holdReads(2);
  const results = await Promise.all([note({ text: 'a' }), note({ text: 'b' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
  assert.equal(stored().notes.length, 100);
});

test('notes: a failing audit write does not fail the request', async () => {
  seedOrder('pending');
  auditFails = true;
  assert.equal((await quietly(() => note({ text: 'x' }))).status, 200);
});

test('customer endpoints never return notes or history notes', async () => {
  const secret = 'SECRET-INTERNAL-NOTE';
  const historySecret = 'SECRET-HISTORY-NOTE';
  seedOrder('dispatched', {
    courier: 'TCS',
    trackingNumber: 'T1',
    notes: [{ _id: new mongoose.Types.ObjectId(), text: secret, by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-02T00:00:00Z') }],
    statusHistory: [{ from: 'processing', to: 'dispatched', by: new mongoose.Types.ObjectId(USER_A), at: new Date('2026-11-03T00:00:00Z'), note: historySecret }],
  });
  const sendPublic = (handler: Handler, path: string) =>
    handler(
      new NextRequest('http://seller.test/api/storefront/v1/stores/' + STORE_A + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ orderId: 'ORD-ABCD2345', phone: '0300 1234567' }),
      }),
      { params: Promise.resolve({ id: STORE_A }) },
    );
  for (const [handler, path] of [
    [trackPOST, '/orders/track'],
    [lookupPOST, '/orders/lookup'],
  ] as const) {
    const res = await sendPublic(handler, path);
    assert.equal(res.status, 200, path);
    const text = await res.text();
    assert.equal(text.includes(secret), false, path);
    assert.equal(text.includes(historySecret), false, path);
    const body = JSON.parse(text) as { data: Record<string, unknown> };
    for (const key of ['notes', 'statusHistory', 'timeline']) assert.equal(key in body.data, false, path + ' ' + key);
  }
  // The seller's own detail does carry them.
  const seller = await detail();
  assert.equal(seller.body.notes[0].text, secret);
});

// =====================================================================================================================
// Timeline

test('timeline: the detail merges placed, history and notes, newest first, with no user ids', async () => {
  const by = new mongoose.Types.ObjectId(USER_A);
  seedOrder('dispatched', {
    statusHistory: [
      { from: 'pending', to: 'confirmed', by, at: new Date('2026-11-02T10:00:00Z'), note: null },
      { from: 'confirmed', to: 'processing', by, at: new Date('2026-11-03T10:00:00Z'), note: null },
      { from: 'processing', to: 'dispatched', by, at: new Date('2026-11-04T10:00:00Z'), note: 'Handed over' },
      // An older entry with no kind.
      { from: 'dispatched', to: 'dispatched', by, at: new Date('2026-11-05T10:00:00Z'), note: 'Tracking updated: courier' },
    ],
    notes: [{ _id: new mongoose.Types.ObjectId('65a0000000000000000b0001'), text: 'Call first', by, at: new Date('2026-11-03T12:00:00Z') }],
  });
  const { status, body } = await detail();
  assert.equal(status, 200);
  assert.equal(dashboardOrderDetailSchema.safeParse(body).success, true);
  assert.deepEqual(
    body.timeline.map((entry: any) => [entry.kind, entry.title, entry.detail]),
    [
      ['tracking', 'Tracking updated', 'courier'],
      ['status', 'Dispatched', 'Handed over'],
      ['note', 'Note added', 'Call first'],
      ['status', 'Processing', null],
      ['status', 'Confirmed', null],
      ['placed', 'Order placed', null],
    ],
  );
  assert.equal(JSON.stringify(body.timeline).includes(USER_A), false);
  // The older fields stay.
  assert.equal(body.statusHistory.length, 4);
  assert.equal(body.statusHistory[0].by, USER_A);
  assert.equal(body.notes.length, 1);
});

test('timeline: an old order with no history has just "Order placed"; a payment shows in the timeline', async () => {
  const row = seedOrder('delivered');
  delete row.statusHistory;
  delete row.notes;
  const old = await detail();
  assert.deepEqual(old.body.timeline.map((entry: any) => entry.title), ['Order placed']);
  const paid = await pay({});
  assert.deepEqual(paid.body.order.timeline.map((entry: any) => [entry.kind, entry.detail]).slice(0, 1), [['payment', 'Rs. 2,500']]);
});
