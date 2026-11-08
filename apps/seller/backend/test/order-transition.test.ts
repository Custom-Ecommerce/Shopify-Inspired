import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { AuditLog, Order, Product, StockMovement, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

// EP-02 OB-2: POST /api/orders/:id/transition and allowedNext on GET /api/orders/:id. Models are stubbed; no database.

const { nextStatuses, orderTransitionResponseSchema, ORDER_FLOW_STATUSES } = unwrapCjs(contractsNs) as typeof contractsNs;

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
const StockModel = StockMovement as any;
const AuditModel = AuditLog as any;

const LEGAL: ReadonlyArray<[string, string]> = [
  ['pending', 'confirmed'],
  ['confirmed', 'processing'],
  ['processing', 'dispatched'],
  ['dispatched', 'delivered'],
];
const isLegal = (from: string, to: string): boolean => LEGAL.some(([f, t]) => f === from && t === to);

// OB-4 (D-064): a move to dispatched must name the courier and the tracking number.
const DISPATCH = { courier: 'TCS', trackingNumber: 'TCS-1001' };
const bodyFor = (to: string, extra: Record<string, unknown> = {}) => ({ status: to, ...(to === 'dispatched' ? DISPATCH : {}), ...extra });

const stores = [
  { _id: STORE_A, owner: USER_A },
  { _id: STORE_B, owner: USER_B },
];

let orders: Array<Record<string, any>> = [];
let audits: Array<Record<string, any>> = [];
let auditFails = false;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let transitionPOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let detailGET: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  transitionPOST = (await import('../src/app/api/orders/[id]/transition/route')).POST;
  detailGET = (await import('../src/app/api/orders/[id]/route')).GET;
});

// ---------------------------------------------------------------------------------------------------------------------
// Stubs. findOneAndUpdate matches and writes in one synchronous step, as MongoDB does for one document, so the
// compare-and-set behaves like the real thing. A read gate can hold the first N reads until all have happened, to force
// two requests to see the same old status.

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
}

const copy = (row: Record<string, any>): Record<string, any> => ({ ...row, statusHistory: [...(row.statusHistory ?? [])] });

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

const lean = (value: () => Promise<unknown> | unknown) => ({ lean: async () => value() });

function touched(name: string): () => never {
  return () => {
    throw new Error('the transition endpoint must not touch ' + name);
  };
}

let restore: (() => void) | null = null;
let writes = 0;

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    findOne: OrderModel.findOne,
    findOneAndUpdate: OrderModel.findOneAndUpdate,
    storeExists: StoreModel.exists,
    storeFindOne: StoreModel.findOne,
    auditCreate: AuditModel.create,
    product: Object.fromEntries(['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany', 'exists', 'countDocuments', 'aggregate', 'bulkWrite'].map((m) => [m, ProductModel[m]])),
    stock: Object.fromEntries(['create', 'insertMany', 'find', 'updateOne'].map((m) => [m, StockModel[m]])),
  };
  orders = [];
  audits = [];
  auditFails = false;
  gate = null;
  writes = 0;

  (mongoose as any).connect = async () => mongoose;
  OrderModel.findOne = (filter: any) =>
    lean(async () => {
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
    });
  OrderModel.findOneAndUpdate = (filter: any, update: any, options: any) =>
    lean(() => {
      assert.equal(options?.new, true);
      const row = orders.find((r) => matches(r, filter));
      if (!row) return null;
      writes += 1;
      Object.assign(row, update.$set ?? {});
      for (const [key, value] of Object.entries(update.$push ?? {})) row[key] = [...(row[key] ?? []), value];
      return copy(row);
    });
  StoreModel.exists = async (filter: any) => (stores.some((s) => matches(s, filter)) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => {
    const q: any = { sort: () => q, select: () => q, lean: async () => stores.find((s) => matches(s, filter)) ?? null };
    return q;
  };
  AuditModel.create = async (doc: Record<string, any>) => {
    if (auditFails) throw new Error('audit store down');
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  // Proof that the endpoint never reads or writes products or stock.
  for (const method of Object.keys(saved.product)) ProductModel[method] = touched('Product.' + method);
  for (const method of Object.keys(saved.stock)) StockModel[method] = touched('StockMovement.' + method);

  restore = () => {
    (mongoose as any).connect = saved.connect;
    OrderModel.findOne = saved.findOne;
    OrderModel.findOneAndUpdate = saved.findOneAndUpdate;
    StoreModel.exists = saved.storeExists;
    StoreModel.findOne = saved.storeFindOne;
    AuditModel.create = saved.auditCreate;
    for (const [method, fn] of Object.entries(saved.product)) ProductModel[method] = fn;
    for (const [method, fn] of Object.entries(saved.stock)) StockModel[method] = fn;
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
    customerName: 'Sara Khan',
    phone: '+923001234567',
    items: [{ productId: '65a0000000000000000c0001', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 2 }],
    subtotal: 2400,
    deliveryCharges: 0,
    total: 2400,
    idempotencyKey: 'idem-key-1',
    requestFingerprint: 'fp-1',
    statusHistory: [],
    notes: [],
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...fields,
  };
  orders.push(row);
  return row;
}

function post(id: string, body: unknown, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  return transitionPOST(
    new NextRequest('http://seller.test/api/orders/' + id + '/transition', {
      method: 'POST',
      headers: h,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function postJson(id: string, body: unknown, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const res = await post(id, body, token, headers);
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

const stored = (id = ORDER_A) => orders.find((row) => String(row._id) === id)!;

// ---------------------------------------------------------------------------------------------------------------------
// Access

test('transition: no login is 401', async () => {
  seedOrder('pending');
  assert.equal((await post(ORDER_A, { status: 'confirmed' }, null)).status, 401);
  assert.equal(stored().status, 'pending');
});

test('transition: an admin session is 403, whatever the body', async () => {
  seedOrder('pending');
  assert.equal((await post(ORDER_A, { status: 'confirmed' }, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await post(ORDER_A, { status: 'nope' }, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal(stored().status, 'pending');
});

test("transition: seller B naming seller A's store is 403", async () => {
  seedOrder('pending');
  assert.equal((await post(ORDER_A, { status: 'confirmed' }, tokenB, { 'x-store-id': STORE_A })).status, 403);
  assert.equal(stored().status, 'pending');
});

test("transition: another store's order and an invalid id are 404", async () => {
  seedOrder('pending', { _id: ORDER_B, store: STORE_B });
  const other = await postJson(ORDER_B, { status: 'confirmed' });
  assert.equal(other.status, 404);
  assert.equal(stored(ORDER_B).status, 'pending');
  assert.equal((await post('not-an-id', { status: 'confirmed' })).status, 404);
  assert.equal((await post('65a0000000000000000a9999', { status: 'confirmed' })).status, 404);
  assert.equal(writes, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// The flow

test('transition: each of the four legal steps moves the order and writes exactly one history entry', async () => {
  for (const [from, to] of LEGAL) {
    orders = [];
    audits = [];
    seedOrder(from);
    const before = Date.now();
    const { status, body, headers } = await postJson(ORDER_A, bodyFor(to, { note: '  step ' + to + '  ' }));
    assert.equal(status, 200, from + ' -> ' + to);
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.equal(orderTransitionResponseSchema.safeParse(body).success, true);
    assert.equal(body.changed, true);
    assert.equal(body.order.status, to);
    assert.deepEqual(body.order.allowedNext, nextStatuses(to));
    assert.equal(stored().status, to);
    assert.equal(stored().statusHistory.length, 1);
    const entry = stored().statusHistory[0];
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'by', 'from', 'note', 'to']);
    assert.equal(entry.from, from);
    assert.equal(entry.to, to);
    assert.equal(String(entry.by), USER_A);
    assert.ok(entry.at instanceof Date && entry.at.getTime() >= before && entry.at.getTime() <= Date.now());
    assert.equal(entry.note, 'step ' + to);
    assert.equal(body.order.statusHistory[0].note, 'step ' + to);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'order.transition');
    assert.equal(audits[0].entityId, ORDER_A);
    assert.equal(audits[0].actorId, 'seller:' + USER_A);
    assert.equal(audits[0].details.from, from);
    assert.equal(audits[0].details.to, to);
  }
});

test('transition: a move without a note stores note null', async () => {
  seedOrder('pending');
  assert.equal((await post(ORDER_A, { status: 'confirmed' })).status, 200);
  assert.equal(stored().statusHistory[0].note, null);
  orders = [];
  seedOrder('pending');
  assert.equal((await post(ORDER_A, { status: 'confirmed', note: '   ' })).status, 200);
  assert.equal(stored().statusHistory[0].note, null);
});

test('transition: every illegal pair answers 422 with the code, from, to and allowedNext, and writes nothing', async () => {
  let checked = 0;
  for (const from of ORDER_FLOW_STATUSES) {
    for (const to of ORDER_FLOW_STATUSES) {
      if (from === to || isLegal(from, to)) continue;
      orders = [];
      seedOrder(from);
      const { status, body } = await postJson(ORDER_A, bodyFor(to));
      assert.equal(status, 422, from + ' -> ' + to);
      const error = body.errors[0];
      assert.equal(error.code, 'ORDER_TRANSITION_ILLEGAL', from + ' -> ' + to);
      assert.equal(error.from, from);
      assert.equal(error.to, to);
      assert.deepEqual(error.allowedNext, nextStatuses(from));
      assert.equal(stored().status, from);
      assert.equal(stored().statusHistory.length, 0);
      checked += 1;
    }
  }
  assert.equal(checked, 38);
  assert.equal(writes, 0);
  assert.equal(audits.length, 0);
});

test('transition: going backwards and skipping a step are refused with their reason', async () => {
  seedOrder('dispatched');
  const back = await postJson(ORDER_A, { status: 'processing' });
  assert.equal(back.status, 422);
  assert.equal(back.body.errors[0].reason, 'backwards');
  orders = [];
  seedOrder('pending');
  const skip = await postJson(ORDER_A, bodyFor('dispatched'));
  assert.equal(skip.status, 422);
  assert.equal(skip.body.errors[0].reason, 'skips_step');
});

test('transition: a corrupt stored status has no legal moves', async () => {
  seedOrder('shipped');
  const { status, body } = await postJson(ORDER_A, { status: 'confirmed' });
  assert.equal(status, 422);
  assert.deepEqual(body.errors[0].allowedNext, []);
  assert.equal(writes, 0);
});

test('transition: the same status again is 200, changed false, nothing written', async () => {
  seedOrder('confirmed', { statusHistory: [{ from: 'pending', to: 'confirmed', by: new mongoose.Types.ObjectId(USER_A), at: new Date(), note: null }] });
  const { status, body } = await postJson(ORDER_A, { status: 'confirmed', note: 'again' });
  assert.equal(status, 200);
  assert.equal(body.changed, false);
  assert.equal(body.order.status, 'confirmed');
  assert.equal(stored().statusHistory.length, 1);
  assert.equal(writes, 0);
  assert.equal(audits.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// Concurrency

test('transition: two parallel identical requests: both 200, one changed, one history entry', async () => {
  seedOrder('pending');
  holdReads(2);
  const results = await Promise.all([postJson(ORDER_A, { status: 'confirmed' }), postJson(ORDER_A, { status: 'confirmed' })]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.deepEqual(results.map((r) => r.body.changed).sort(), [false, true]);
  assert.equal(stored().status, 'confirmed');
  assert.equal(stored().statusHistory.length, 1);
  assert.equal(writes, 1);
  assert.equal(audits.length, 1);
});

test('transition: two parallel requests for different targets: one wins, the other is refused, one history entry', async () => {
  seedOrder('pending');
  holdReads(2);
  const results = await Promise.all([postJson(ORDER_A, { status: 'confirmed' }), postJson(ORDER_A, { status: 'processing' })]);
  const statuses = results.map((r) => r.status).sort();
  assert.equal(statuses.filter((s) => s === 200).length, 1);
  assert.ok(statuses.every((s) => s === 200 || s === 409 || s === 422), String(statuses));
  assert.equal(results.filter((r) => r.body.changed === true).length, 1);
  assert.equal(stored().statusHistory.length, 1);
  assert.equal(writes, 1);
});

test('transition: when the order changes between the read and the write the answer is 409 with the new status', async () => {
  seedOrder('pending');
  // A parallel cancel (OB-3) lands after this request read "pending" and before its compare-and-set.
  holdReads(1, () => {
    stored().status = 'cancelled';
  });
  const { status, body } = await postJson(ORDER_A, { status: 'confirmed' });
  assert.equal(status, 409);
  assert.equal(body.errors[0].code, 'ORDER_STATUS_CHANGED');
  assert.equal(body.errors[0].status, 'cancelled');
  assert.deepEqual(body.errors[0].allowedNext, []);
  assert.equal(stored().statusHistory.length, 0);
  assert.equal(writes, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// The body

test('transition: bad bodies are 400 ORDER_BODY_INVALID with the field named', async () => {
  seedOrder('processing');
  const cases: Array<[unknown, string | null]> = [
    [{ status: 'shipped' }, 'status'],
    [{}, 'status'],
    [{ status: 'dispatched', note: 'x'.repeat(501) }, 'note'],
    [{ status: 'dispatched', trackingUrl: 'tcs.test/123' }, 'trackingUrl'],
    [{ status: 'dispatched', trackingUrl: 'ftp://tcs.test/123' }, 'trackingUrl'],
    [{ status: 'dispatched', courier: 'x'.repeat(61) }, 'courier'],
    ['not json', null],
  ];
  for (const [body, field] of cases) {
    const res = await postJson(ORDER_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.errors[0].code, 'ORDER_BODY_INVALID');
    assert.equal(res.body.errors[0].field, field, JSON.stringify(body));
  }
  orders = [];
  seedOrder('pending');
  for (const field of ['courier', 'trackingNumber', 'trackingUrl']) {
    const value = field === 'trackingUrl' ? 'https://tcs.test/1' : 'TCS';
    const res = await postJson(ORDER_A, { status: 'confirmed', [field]: value });
    assert.equal(res.status, 400, field);
    assert.equal(res.body.errors[0].field, field);
  }
  assert.equal(writes, 0);
});

test('transition: unknown keys in the body are ignored, never stored', async () => {
  seedOrder('pending');
  const res = await postJson(ORDER_A, { status: 'confirmed', store: STORE_B, total: 1, statusHistory: [], paymentStatus: 'collected' });
  assert.equal(res.status, 200);
  assert.equal(stored().store, STORE_A);
  assert.equal(stored().total, 2400);
  assert.equal(stored().paymentStatus, undefined);
  assert.equal(stored().statusHistory.length, 1);
});

test('transition: dispatch stores courier, tracking number and link; dispatch without them is refused (OB-4)', async () => {
  seedOrder('processing');
  const res = await postJson(ORDER_A, {
    status: 'dispatched', courier: ' TCS ', trackingNumber: ' 7788 ', trackingUrl: 'https://tcs.test/track/7788', note: 'Handed over',
  });
  assert.equal(res.status, 200);
  assert.equal(stored().courier, 'TCS');
  assert.equal(stored().trackingNumber, '7788');
  assert.equal(stored().trackingUrl, 'https://tcs.test/track/7788');
  assert.equal(res.body.order.courier, 'TCS');
  assert.equal(res.body.order.trackingNumber, '7788');

  // OB-4 (D-064): a dispatch without courier and tracking number is refused on the courier field, and nothing moves.
  orders = [];
  seedOrder('processing');
  const bare = await postJson(ORDER_A, { status: 'dispatched' });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.errors[0].code, 'ORDER_BODY_INVALID');
  assert.equal(bare.body.errors[0].field, 'courier');
  assert.equal(stored().status, 'processing');
  assert.equal(stored().courier, undefined);
});

test('transition (OB-4): dispatch without a courier, without a tracking number, with a bad link or a long name is 400', async () => {
  seedOrder('processing');
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ status: 'dispatched', trackingNumber: 'T1' }, 'courier'],
    [{ status: 'dispatched', courier: 'TCS' }, 'trackingNumber'],
    [{ status: 'dispatched', courier: 'TCS', trackingNumber: '   ' }, 'trackingNumber'],
    [{ ...DISPATCH, status: 'dispatched', trackingUrl: 'ftp://tcs.test/1' }, 'trackingUrl'],
    [{ ...DISPATCH, status: 'dispatched', trackingUrl: 'javascript:alert(1)' }, 'trackingUrl'],
    [{ ...DISPATCH, status: 'dispatched', courier: 'x'.repeat(41) }, 'courier'],
    [{ ...DISPATCH, status: 'dispatched', courier: 'X' }, 'courier'],
    [{ ...DISPATCH, status: 'dispatched', trackingNumber: 'x'.repeat(61) }, 'trackingNumber'],
  ];
  for (const [body, field] of cases) {
    const res = await postJson(ORDER_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.errors[0].field, field, JSON.stringify(body));
  }
  assert.equal(stored().status, 'processing');
  assert.equal(writes, 0);
  // A courier name from outside the suggested list is fine.
  const other = await postJson(ORDER_A, { status: 'dispatched', courier: 'Swift Riders', trackingNumber: 'SR-9' });
  assert.equal(other.status, 200);
  assert.equal(stored().courier, 'Swift Riders');
});

// ---------------------------------------------------------------------------------------------------------------------
// Products, audit, detail

test('transition: an order whose product was taken down or trashed still moves on; products are never touched', async () => {
  // Every Product and StockMovement method throws in these tests, so any product read would fail the request.
  seedOrder('pending');
  for (const to of ['confirmed', 'processing', 'dispatched', 'delivered']) {
    const res = await postJson(ORDER_A, bodyFor(to));
    assert.equal(res.status, 200, to);
  }
  assert.equal(stored().status, 'delivered');
  assert.equal(stored().statusHistory.length, 4);
  const detail = await detailGET(new NextRequest('http://seller.test/api/orders/' + ORDER_A, { headers: { authorization: 'Bearer ' + tokenA } }), {
    params: Promise.resolve({ id: ORDER_A }),
  });
  assert.equal(detail.status, 200);
});

test('transition: a failing audit write does not fail the request', async () => {
  seedOrder('pending');
  auditFails = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await postJson(ORDER_A, { status: 'confirmed' });
    assert.equal(res.status, 200);
    assert.equal(res.body.changed, true);
  } finally {
    console.error = originalError;
  }
  assert.equal(stored().status, 'confirmed');
  assert.equal(stored().statusHistory.length, 1);
});

test('detail: allowedNext follows the stored status, empty for delivered, cancelled, returned and a corrupt status', async () => {
  for (const status of [...ORDER_FLOW_STATUSES, 'shipped']) {
    orders = [];
    seedOrder(status);
    const res = await detailGET(new NextRequest('http://seller.test/api/orders/' + ORDER_A, { headers: { authorization: 'Bearer ' + tokenA } }), {
      params: Promise.resolve({ id: ORDER_A }),
    });
    assert.equal(res.status, 200, status);
    const body = (await res.json()) as any;
    assert.deepEqual(body.allowedNext, nextStatuses(status), status);
    if (['delivered', 'cancelled', 'returned', 'shipped'].includes(status)) assert.deepEqual(body.allowedNext, [], status);
  }
});

test('transition: the response never carries idempotencyKey or requestFingerprint', async () => {
  seedOrder('pending');
  const res = await post(ORDER_A, { status: 'confirmed' });
  const text = await res.text();
  assert.equal(text.includes('idempotencyKey'), false);
  assert.equal(text.includes('requestFingerprint'), false);
  assert.equal(text.includes('idem-key-1'), false);
});
