import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Order, Product, StockMovement, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { orderListFilters, parseOrderListRequest, toDashboardOrderDetail, toDashboardOrderListItem } from '@/lib/orders';

// Sprint 5 EP-11.US01 (D-107): the phone confirmation decision, the dispatch refusal, the unconfirmed filter and the isolation between
// sellers. Every model is stubbed in memory (no database). The stubs match and write in one synchronous step, as MongoDB does for one
// document, so two requests that both read before either writes have exactly one winner.

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const ORDER_A = '65a0000000000000000a0001';
const ORDER_B = '65a0000000000000000a0002';
const ORDER_OLD = '65a0000000000000000a0003';
const SHIRT = '65a0000000000000000c0001';
const SHIRT_M = '65a0000000000000000d0002';
const T0 = new Date('2026-11-14T10:00:00Z');
const NOTE_TEXT = 'Customer asked to call after 6 pm';
const PHONE = '+923001234567';

const OrderModel = Order as any;
const StoreModel = Store as any;
const UserModel = User as any;
const ProductModel = Product as any;
const MovementModel = StockMovement as any;
const AuditModel = AuditLog as any;

type Row = Record<string, any>;
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let orders: Row[] = [];
let stores: Row[] = [];
let users: Record<string, Row> = {};
let variants: Array<{ _id: string; stockQuantity: number }> = [];
let movements: Row[] = [];
let audits: Row[] = [];
let orderWrites = 0;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};
let confirmationPOST: Handler;
let transitionPOST: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  confirmationPOST = (await import('../src/app/api/stores/[id]/orders/[orderId]/confirmation/route')).POST as Handler;
  transitionPOST = (await import('../src/app/api/orders/[id]/transition/route')).POST as Handler;
});

// ---------------------------------------------------------------------------------------------------------------------
// Stubs

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$exists' in value) return (row[key] !== undefined) === Boolean(value.$exists);
    if (value && typeof value === 'object' && '$ne' in value) return String(row[key]) !== String(value.$ne);
    return String(row[key]) === String(value);
  });
}

const copy = (row: Row): Row => ({
  ...row,
  statusHistory: [...(row.statusHistory ?? [])],
  ...(row.confirmationLog === undefined ? {} : { confirmationLog: [...row.confirmationLog] }),
});

interface ReadGate {
  expected: number;
  arrived: number;
  release: () => void;
  released: Promise<void>;
}
let gate: ReadGate | null = null;

/** The first `expected` order reads wait for each other, so every request has read before any of them writes. */
function holdReads(expected: number): void {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  gate = { expected, arrived: 0, release, released };
}

const chain = (read: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => read() };
  return q;
};

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    oFindOne: OrderModel.findOne,
    oFOAU: OrderModel.findOneAndUpdate,
    sExists: StoreModel.exists,
    sFindOne: StoreModel.findOne,
    userFindById: UserModel.findById,
    pFOAU: ProductModel.findOneAndUpdate,
    pExists: ProductModel.exists,
    mCreate: MovementModel.create,
    aCreate: AuditModel.create,
  };
  stores = [
    { _id: STORE_A, owner: USER_A, name: 'Zara Lawn' },
    { _id: STORE_B, owner: USER_B, name: 'Bilal Shoes' },
  ];
  users = {
    [USER_A]: { _id: USER_A, role: 'seller', email: 'a@seller.test', emailVerifiedAt: T0 },
    [USER_B]: { _id: USER_B, role: 'seller', email: 'b@seller.test', emailVerifiedAt: T0 },
    [ADMIN]: { _id: ADMIN, role: 'admin', email: 'admin@markazify.test', emailVerifiedAt: T0 },
  };
  orders = [];
  variants = [{ _id: SHIRT_M, stockQuantity: 1 }];
  movements = [];
  audits = [];
  orderWrites = 0;
  gate = null;

  (mongoose as any).connect = async () => mongoose;
  OrderModel.findOne = (filter: Row) => ({
    lean: async () => {
      const found = orders.find((row) => matches(row, filter));
      const snapshot = found ? copy(found) : null;
      if (gate && gate.arrived < gate.expected) {
        gate.arrived += 1;
        if (gate.arrived === gate.expected) gate.release();
        await gate.released;
      }
      return snapshot;
    },
  });
  OrderModel.findOneAndUpdate = (filter: Row, update: Row) => ({
    lean: async () => {
      const row = orders.find((r) => matches(r, filter));
      if (!row) return null;
      orderWrites += 1;
      Object.assign(row, update.$set ?? {});
      for (const [key, value] of Object.entries(update.$push ?? {}) as Array<[string, any]>) {
        const adds = value && typeof value === 'object' && '$each' in value ? value.$each : [value];
        let next = [...(row[key] ?? []), ...adds];
        if (value && typeof value === 'object' && typeof value.$slice === 'number') next = next.slice(value.$slice);
        row[key] = next;
      }
      return copy(row);
    },
  });
  StoreModel.exists = async (filter: Row) => (stores.some((s) => matches(s, filter)) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: Row) => chain(() => structuredClone(stores.find((s) => matches(s, filter)) ?? null));
  UserModel.findById = (id: unknown) => chain(() => users[String(id)] ?? null);
  ProductModel.findOneAndUpdate = (_filter: Row, update: Row) =>
    chain(() => {
      const variant = variants.find((v) => v._id === SHIRT_M)!;
      variant.stockQuantity += update.$inc['variants.$.stockQuantity'];
      return { variants: variants.map((v) => ({ ...v })) };
    });
  ProductModel.exists = async () => ({ _id: SHIRT });
  MovementModel.create = async (doc: Row) => {
    movements.push(doc);
    return doc;
  };
  AuditModel.create = async (doc: Row) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };

  restore = () => {
    (mongoose as any).connect = saved.connect;
    OrderModel.findOne = saved.oFindOne;
    OrderModel.findOneAndUpdate = saved.oFOAU;
    StoreModel.exists = saved.sExists;
    StoreModel.findOne = saved.sFindOne;
    UserModel.findById = saved.userFindById;
    ProductModel.findOneAndUpdate = saved.pFOAU;
    ProductModel.exists = saved.pExists;
    MovementModel.create = saved.mCreate;
    AuditModel.create = saved.aCreate;
  };
});

afterEach(() => restore());

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

function seed(fields: Row = {}): Row {
  const row: Row = {
    _id: ORDER_A,
    store: STORE_A,
    orderId: 'ORD-ABCD2345',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    customerName: 'Sara Khan',
    phone: PHONE,
    phoneKey: PHONE,
    customerEmail: 'sara@example.pk',
    address: 'House 1, Street 2',
    city: 'Lahore',
    items: [{ productId: SHIRT, variantId: SHIRT_M, productTitle: 'T-Shirt', variantTitle: 'M', unitPrice: 1000, quantity: 2, stockDeducted: true }],
    subtotal: 2000,
    deliveryCharges: 0,
    total: 2000,
    confirmationStatus: 'unconfirmed',
    riskFlags: ['new_customer'],
    statusHistory: [],
    notes: [],
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...fields,
  };
  orders.push(row);
  return row;
}

const stored = (id = ORDER_A): Row => orders.find((row) => String(row._id) === id)!;

function confirm(body: unknown, options: { store?: string; order?: string; token?: string | null } = {}) {
  const store = options.store ?? STORE_A;
  const order = options.order ?? ORDER_A;
  const token = options.token === undefined ? tokenA : options.token;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  return confirmationPOST(
    new NextRequest('http://seller.test/api/stores/' + store + '/orders/' + order + '/confirmation', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: store, orderId: order }) },
  );
}

async function decide(body: unknown, options: { store?: string; order?: string; token?: string | null } = {}) {
  const res = await confirm(body, options);
  return { status: res.status, body: (await res.json()) as any };
}

async function transition(id: string, body: unknown, token = tokenA) {
  const res = await transitionPOST(
    new NextRequest('http://seller.test/api/orders/' + id + '/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'x-store-id': STORE_A },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as any };
}

const DISPATCH = { status: 'dispatched', courier: 'TCS', trackingNumber: 'TCS123' };

// ---------------------------------------------------------------------------------------------------------------------
// Access and body

test('confirmation: no login is 401, an admin session is 403, and nothing is written', async () => {
  seed();
  assert.equal((await confirm({ result: 'confirmed' }, { token: null })).status, 401);
  assert.equal((await confirm({ result: 'confirmed' }, { token: tokenAdmin })).status, 403);
  assert.equal((await confirm({}, { token: tokenAdmin })).status, 403);
  assert.equal(stored().confirmationStatus, 'unconfirmed');
  assert.equal(orderWrites, 0);
});

test("confirmation: Seller B cannot decide Seller A's order: A's store is 403, and B's own store does not have the order (404)", async () => {
  seed();
  assert.equal((await confirm({ result: 'confirmed' }, { token: tokenB, store: STORE_A })).status, 403);
  assert.equal((await confirm({ result: 'cancel' }, { token: tokenB, store: STORE_A })).status, 403);
  assert.equal((await confirm({ result: 'confirmed' }, { token: tokenB, store: STORE_B })).status, 404);
  assert.equal((await confirm({ result: 'confirmed' }, { token: tokenA, store: STORE_B })).status, 403);
  assert.equal(stored().confirmationStatus, 'unconfirmed');
  assert.equal(stored().status, 'pending');
  assert.equal(orderWrites, 0);
  assert.equal(variants[0]!.stockQuantity, 1, 'no stock moved');
});

test("confirmation: another store's order id is 404 and so is a malformed id", async () => {
  seed({ _id: ORDER_B, store: STORE_B });
  assert.equal((await confirm({ result: 'confirmed' }, { order: ORDER_B })).status, 404);
  assert.equal((await confirm({ result: 'confirmed' }, { order: 'not-an-id' })).status, 404);
  assert.equal(stored(ORDER_B).confirmationStatus, 'unconfirmed');
  assert.equal(orderWrites, 0);
});

test('confirmation: a bad body is 400 and names the field', async () => {
  seed();
  const cases: Array<[unknown, string]> = [
    [{}, 'result'],
    [{ result: 'maybe' }, 'result'],
    [{ result: 'confirmed', note: 'x'.repeat(201) }, 'note'],
    [{ result: 'confirmed', note: 'call <b>me</b>' }, 'note'],
    [{ result: 'confirmed', status: 'delivered' }, 'status'],
    [{ result: 'confirmed', confirmationStatus: 'confirmed' }, 'confirmationStatus'],
    ['not json', 'body'],
  ];
  for (const [body, field] of cases) {
    const res = await decide(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.field, field, JSON.stringify(body));
  }
  assert.equal(stored().confirmationStatus, 'unconfirmed');
  assert.equal(orderWrites, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// Decisions

test('confirmation: confirmed sets the status and writes one log entry (who, when, result, note); the order keeps its own status', async () => {
  seed();
  const before = Date.now();
  const res = await decide({ result: 'confirmed', note: '  Spoke to her, address is right  ' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'confirmed');
  assert.equal(res.body.confirmationStatus, 'confirmed');
  assert.equal(res.body.order.confirmationStatus, 'confirmed');
  const row = stored();
  assert.equal(row.confirmationStatus, 'confirmed');
  assert.equal(row.status, 'pending', "the order's own status is the seller's next step, not this decision");
  assert.equal(row.confirmationLog.length, 1);
  const entry = row.confirmationLog[0];
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'by', 'note', 'result']);
  assert.equal(entry.result, 'confirmed');
  assert.equal(entry.note, 'Spoke to her, address is right');
  assert.equal(String(entry.by), USER_A);
  assert.ok(entry.at instanceof Date && entry.at.getTime() >= before);
  // The detail the seller reads carries the log, newest first, with the user id as text.
  assert.deepEqual(res.body.order.confirmationLog.map((e: any) => [e.result, e.note, e.by]), [['confirmed', 'Spoke to her, address is right', USER_A]]);
});

test('confirmation: unreachable is a decision too; an empty note is no note', async () => {
  seed();
  const res = await decide({ result: 'unreachable', note: '   ' });
  assert.equal(res.status, 200);
  assert.equal(stored().confirmationStatus, 'unreachable');
  assert.equal(stored().confirmationLog[0].result, 'unreachable');
  assert.equal(stored().confirmationLog[0].note, null);
});

test('confirmation: a second decision answers 409 and changes nothing', async () => {
  seed();
  assert.equal((await decide({ result: 'unreachable' })).status, 200);
  const writes = orderWrites;
  for (const result of ['confirmed', 'unreachable', 'cancel']) {
    const again = await decide({ result });
    assert.equal(again.status, 409, result);
    assert.equal(again.body.errors[0].code, 'ORDER_CONFIRMATION_DECIDED');
    assert.equal(again.body.errors[0].status, 'unreachable');
  }
  assert.equal(orderWrites, writes, 'no write was made');
  assert.equal(stored().confirmationLog.length, 1);
  assert.equal(stored().status, 'pending');
  assert.equal(variants[0]!.stockQuantity, 1);
});

test('confirmation: an order that never waited for a decision (card, older order) answers 409 too', async () => {
  seed({ confirmationStatus: 'not_required', riskFlags: undefined });
  seed({ _id: ORDER_OLD, confirmationStatus: undefined, riskFlags: undefined });
  for (const order of [ORDER_A, ORDER_OLD]) {
    const res = await decide({ result: 'confirmed' }, { order });
    assert.equal(res.status, 409, order);
    assert.equal(res.body.errors[0].code, 'ORDER_CONFIRMATION_DECIDED');
    assert.equal(res.body.errors[0].status, 'not_required');
  }
  assert.equal(orderWrites, 0);
});

test('confirmation: two parallel confirmations leave ONE decision and ONE log entry', async () => {
  seed();
  holdReads(2);
  const results = await Promise.all([decide({ result: 'confirmed', note: 'first' }), decide({ result: 'unreachable', note: 'second' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(stored().confirmationLog.length, 1);
  assert.equal(orderWrites, 1, 'exactly one compare-and-set matched');
  const winner = results.find((r) => r.status === 200)!;
  assert.equal(stored().confirmationStatus, winner.body.result);
  assert.equal(results.find((r) => r.status === 409)!.body.errors[0].code, 'ORDER_CONFIRMATION_DECIDED');
});

test('confirmation: two parallel confirmations of the same result also leave one entry', async () => {
  seed();
  holdReads(2);
  const results = await Promise.all([decide({ result: 'confirmed' }), decide({ result: 'confirmed' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(stored().confirmationLog.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Cancel

test('confirmation: cancel goes through the cancel path: the order is cancelled and its stock goes back exactly once', async () => {
  seed();
  const res = await decide({ result: 'cancel', note: NOTE_TEXT });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'cancelled');
  const row = stored();
  assert.equal(row.status, 'cancelled');
  assert.equal(row.cancelReason, 'Declined on the confirmation call');
  assert.ok(row.stockRestoredAt instanceof Date, 'the one-time stock marker is set in the cancel write');
  assert.equal(variants[0]!.stockQuantity, 3, 'the 2 units went back');
  assert.equal(movements.length, 1);
  assert.equal(row.confirmationLog.length, 1);
  assert.equal(row.confirmationLog[0].result, 'cancelled');
  assert.equal(row.confirmationLog[0].note, NOTE_TEXT);
  // The decision and the cancel were ONE write on the order, not a status write and then a cancel.
  assert.equal(orderWrites, 1);

  // A second decision (any result) and a second cancel give nothing back again.
  for (const result of ['cancel', 'confirmed']) assert.equal((await decide({ result })).status, 409, result);
  assert.equal(variants[0]!.stockQuantity, 3);
  assert.equal(movements.length, 1);
  assert.equal(orderWrites, 1);
});

test('confirmation: a cancel and a confirmation racing leave one decision, and stock moves only if the cancel won', async () => {
  seed();
  holdReads(2);
  const results = await Promise.all([decide({ result: 'cancel' }), decide({ result: 'confirmed' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(stored().confirmationLog.length, 1);
  const cancelled = stored().status === 'cancelled';
  assert.equal(variants[0]!.stockQuantity, cancelled ? 3 : 1);
  assert.equal(stored().confirmationStatus === 'confirmed', !cancelled);
  assert.equal(movements.length, cancelled ? 1 : 0);
});

test('confirmation: two parallel cancels return the stock once', async () => {
  seed();
  holdReads(2);
  const results = await Promise.all([decide({ result: 'cancel' }), decide({ result: 'cancel' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(variants[0]!.stockQuantity, 3);
  assert.equal(movements.length, 1);
  assert.equal(stored().confirmationLog.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Audit

test('confirmation: the audit entry names the result and holds no note text, phone or email', async () => {
  seed();
  assert.equal((await decide({ result: 'confirmed', note: NOTE_TEXT })).status, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'order.confirmation');
  assert.equal(audits[0]!.actorId, 'seller:' + USER_A);
  assert.deepEqual(Object.keys(audits[0]!.details).sort(), ['at', 'hasNote', 'orderId', 'result', 'storeId']);
  assert.equal(audits[0]!.details.result, 'confirmed');
  assert.equal(audits[0]!.details.hasNote, true);
  const text = JSON.stringify(audits);
  for (const secret of [NOTE_TEXT, PHONE, '03001234567', 'sara@example.pk']) assert.equal(text.includes(secret), false, secret);
});

test('confirmation: a cancel decision writes the cancel audit without the note text as well', async () => {
  seed();
  assert.equal((await decide({ result: 'cancel', note: NOTE_TEXT })).status, 200);
  const actions = audits.map((a) => a.action).sort();
  assert.deepEqual(actions, ['order.cancel', 'order.confirmation']);
  const text = JSON.stringify(audits);
  for (const secret of [NOTE_TEXT, PHONE, 'sara@example.pk']) assert.equal(text.includes(secret), false, secret);
});

test('confirmation: a failing audit store never fails the decision', async () => {
  seed();
  AuditModel.create = async () => {
    throw new Error('audit store down');
  };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await decide({ result: 'confirmed' })).status, 200);
  } finally {
    console.error = original;
  }
  assert.equal(stored().confirmationStatus, 'confirmed');
});

// ---------------------------------------------------------------------------------------------------------------------
// The dispatch

test('dispatch: refused 422 ORDER_NOT_CONFIRMED while the order is unconfirmed; the order does not move', async () => {
  seed({ status: 'processing' });
  const res = await transition(ORDER_A, DISPATCH);
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'ORDER_NOT_CONFIRMED');
  assert.equal(res.body.errors[0].from, 'processing');
  assert.equal(stored().status, 'processing');
  assert.equal(stored().statusHistory.length, 0);
  assert.equal(orderWrites, 0);
});

test('dispatch: the detail the seller reads does not offer a dispatch while unconfirmed', () => {
  const detail = toDashboardOrderDetail(seed({ status: 'processing' }));
  assert.equal(detail.confirmationStatus, 'unconfirmed');
  assert.deepEqual(detail.allowedNext, []);
  const confirmed = toDashboardOrderDetail({ ...stored(), confirmationStatus: 'confirmed' });
  assert.deepEqual(confirmed.allowedNext, ['dispatched']);
});

test('dispatch: only the dispatch is refused; the other moves of an unconfirmed order work as before', async () => {
  seed({ status: 'pending' });
  const res = await transition(ORDER_A, { status: 'confirmed' });
  assert.equal(res.status, 200);
  assert.equal(stored().status, 'confirmed');
  assert.equal(stored().confirmationStatus, 'unconfirmed');
  assert.equal((await transition(ORDER_A, { status: 'processing' })).status, 200);
  assert.equal((await transition(ORDER_A, DISPATCH)).status, 422);
});

test('dispatch: allowed after the seller confirmed, and after the seller marked the customer unreachable', async () => {
  seed({ status: 'processing' });
  assert.equal((await decide({ result: 'confirmed' })).status, 200);
  const sent = await transition(ORDER_A, DISPATCH);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.changed, true);
  assert.equal(stored().status, 'dispatched');

  seed({ _id: ORDER_B, orderId: 'ORD-BBBB2222', status: 'processing' });
  assert.equal((await decide({ result: 'unreachable' }, { order: ORDER_B })).status, 200);
  assert.equal((await transition(ORDER_B, DISPATCH)).status, 200);
  assert.equal(stored(ORDER_B).status, 'dispatched');
});

test('dispatch: an older order (no confirmation field) and a card order are never refused', async () => {
  seed({ status: 'processing', confirmationStatus: undefined, riskFlags: undefined });
  assert.equal((await transition(ORDER_A, DISPATCH)).status, 200);
  seed({ _id: ORDER_B, orderId: 'ORD-BBBB2222', status: 'processing', paymentMethod: 'card', paymentStatus: 'paid', confirmationStatus: 'not_required' });
  assert.equal((await transition(ORDER_B, DISPATCH)).status, 200);
});

test('dispatch: the refusal and the dispatch are one read and one compare-and-set; a refused dispatch never writes', async () => {
  seed({ status: 'processing' });
  await transition(ORDER_A, DISPATCH);
  assert.equal(orderWrites, 0);
  await decide({ result: 'confirmed' });
  assert.equal(orderWrites, 1);
  await transition(ORDER_A, DISPATCH);
  assert.equal(orderWrites, 2, 'the dispatch itself is exactly one write');
});

// ---------------------------------------------------------------------------------------------------------------------
// The order list: flags, status and the unconfirmed filter

test('list: an order maps its confirmation status and flags; an older order reads as not_required with no flags', () => {
  const unconfirmed = toDashboardOrderListItem(seed({ riskFlags: ['high_value', 'flagged_city'] }));
  assert.equal(unconfirmed.confirmationStatus, 'unconfirmed');
  assert.deepEqual(unconfirmed.riskFlags, ['high_value', 'flagged_city']);
  const old = toDashboardOrderListItem(seed({ _id: ORDER_OLD, confirmationStatus: undefined, riskFlags: undefined }));
  assert.equal(old.confirmationStatus, 'not_required');
  assert.deepEqual(old.riskFlags, []);
  // A stored value outside the lists is ignored, not shown.
  const odd = toDashboardOrderListItem({ ...stored(), confirmationStatus: 'banana', riskFlags: ['high_value', 'banana'] });
  assert.equal(odd.confirmationStatus, 'not_required');
  assert.deepEqual(odd.riskFlags, ['high_value']);
});

test('list: confirmation=unconfirmed keeps only waiting orders of the store and never shows a cancelled one', () => {
  const parsed = parseOrderListRequest(new URLSearchParams('confirmation=unconfirmed'));
  assert.equal(parsed.mode, 'list');
  if (parsed.mode !== 'list') return;
  const filters = orderListFilters(STORE_A, parsed.query);
  assert.equal((filters.list as Row).confirmationStatus, 'unconfirmed');
  assert.deepEqual((filters.list as Row).status, { $ne: 'cancelled' });
  assert.equal(String((filters.list as Row).store), STORE_A);
  // The tab counts are not narrowed by it.
  assert.equal('confirmationStatus' in filters.counts, false);

  const withStatus = parseOrderListRequest(new URLSearchParams('confirmation=unconfirmed&status=pending'));
  if (withStatus.mode === 'list') assert.equal((orderListFilters(STORE_A, withStatus.query).list as Row).status, 'pending');
  // Without the parameter nothing changes.
  const plain = parseOrderListRequest(new URLSearchParams('status=pending'));
  if (plain.mode === 'list') assert.equal('confirmationStatus' in orderListFilters(STORE_A, plain.query).list, false);
  // Only the one value is accepted.
  assert.throws(() => parseOrderListRequest(new URLSearchParams('confirmation=all')), (err: any) => err.status === 400 && err.code === 'ORDER_QUERY_INVALID');
});

test('detail: the customer key is the phone key, else the lower-case email, else null (the key of the customer page)', () => {
  assert.equal(toDashboardOrderDetail(seed()).customerKey, PHONE);
  assert.equal(toDashboardOrderDetail({ ...stored(), phoneKey: undefined, customerEmail: ' Sara@Example.PK ' }).customerKey, 'sara@example.pk');
  assert.equal(toDashboardOrderDetail({ ...stored(), phoneKey: undefined, customerEmail: null }).customerKey, null);
});
