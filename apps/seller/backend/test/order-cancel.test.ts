import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { AuditLog, Discount, Order, Product, StockMovement, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { lineName, restoreOrderStock, stockRestoreSummary } from '@/lib/order-stock';
import { toDashboardOrderDetail } from '@/lib/orders';
import { stripeClient } from '../src/lib/storefront/card-payment';

// EP-02 OB-3: POST /api/orders/:id/cancel and the stock restore (D-064, D-066, D-067). Models are stubbed; no database.

const { orderCancelResponseSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const ORDER_A = '65a0000000000000000a0001';
const ORDER_B = '65a0000000000000000a0002';

// Products and variants.
const SHIRT = '65a0000000000000000c0001';
const SHIRT_S = '65a0000000000000000d0001';
const SHIRT_M = '65a0000000000000000d0002';
const MUG = '65a0000000000000000c0002';
const MUG_DEFAULT = '65a0000000000000000d0003';
const CAP = '65a0000000000000000c0003';
const CAP_DEFAULT = '65a0000000000000000d0004';
const GONE = '65a0000000000000000c0009';
const GONE_VARIANT = '65a0000000000000000d0009';

const OrderModel = Order as any;
const StoreModel = Store as any;
const ProductModel = Product as any;
const MovementModel = StockMovement as any;
const AuditModel = AuditLog as any;

const stores = [
  { _id: STORE_A, owner: USER_A },
  { _id: STORE_B, owner: USER_B },
];

interface VariantRow {
  _id: string;
  title: string;
  trackQuantity: boolean;
  stockQuantity: number;
}

let orders: Array<Record<string, any>> = [];
let products: Array<{ _id: string; store: string; deletedAt: Date | null; isPublished: boolean; variants: VariantRow[] }> = [];
let movements: Array<Record<string, any>> = [];
let audits: Array<Record<string, any>> = [];
let auditFails = false;
let failingProduct: string | null = null;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let cancelPOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  cancelPOST = (await import('../src/app/api/orders/[id]/cancel/route')).POST;
});

// ---------------------------------------------------------------------------------------------------------------------
// Stubs. Each findOneAndUpdate matches and writes in one synchronous step, as MongoDB does for one document.

function orderMatches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$exists' in value) return (row[key] !== undefined) === Boolean(value.$exists);
    if (value && typeof value === 'object' && '$ne' in value) return row[key] !== value.$ne;
    return String(row[key]) === String(value);
  });
}

function findVariant(filter: Record<string, any>): VariantRow | null | undefined {
  const product = products.find((p) => p._id === String(filter._id) && p.store === String(filter.store));
  if (!product) return undefined;
  const wanted = filter.variants?.$elemMatch;
  if (!wanted) return null;
  const variant = product.variants.find((v) => v._id === String(wanted._id));
  if (!variant) return undefined;
  if (wanted.trackQuantity !== undefined && variant.trackQuantity !== wanted.trackQuantity) return undefined;
  return variant;
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

let restore: (() => void) | null = null;
let cancelWrites = 0;

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    oFindOne: OrderModel.findOne,
    oFOAU: OrderModel.findOneAndUpdate,
    sExists: StoreModel.exists,
    sFindOne: StoreModel.findOne,
    pFOAU: ProductModel.findOneAndUpdate,
    pExists: ProductModel.exists,
    pFind: ProductModel.find,
    pFindOne: ProductModel.findOne,
    mCreate: MovementModel.create,
    aCreate: AuditModel.create,
  };
  orders = [];
  movements = [];
  audits = [];
  auditFails = false;
  failingProduct = null;
  gate = null;
  cancelWrites = 0;
  products = [
    {
      _id: SHIRT, store: STORE_A, deletedAt: null, isPublished: true,
      variants: [
        { _id: SHIRT_S, title: 'S', trackQuantity: true, stockQuantity: 4 },
        { _id: SHIRT_M, title: 'M', trackQuantity: true, stockQuantity: 1 },
      ],
    },
    { _id: MUG, store: STORE_A, deletedAt: null, isPublished: true, variants: [{ _id: MUG_DEFAULT, title: 'Default', trackQuantity: true, stockQuantity: 0 }] },
    { _id: CAP, store: STORE_A, deletedAt: null, isPublished: true, variants: [{ _id: CAP_DEFAULT, title: 'Default', trackQuantity: false, stockQuantity: 0 }] },
  ];

  (mongoose as any).connect = async () => mongoose;
  OrderModel.findOne = (filter: any) => ({
    lean: async () => {
      const found = orders.find((row) => orderMatches(row, filter));
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
  });
  OrderModel.findOneAndUpdate = (filter: any, update: any, options: any) => ({
    lean: async () => {
      assert.equal(options?.new, true);
      const row = orders.find((r) => orderMatches(r, filter));
      if (!row) return null;
      if (update.$set?.status === 'cancelled') cancelWrites += 1;
      Object.assign(row, update.$set ?? {});
      for (const [key, value] of Object.entries(update.$push ?? {})) row[key] = [...(row[key] ?? []), value];
      return copy(row);
    },
  });
  StoreModel.exists = async (filter: any) => (stores.some((s) => orderMatches(s, filter)) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => {
    const q: any = { sort: () => q, select: () => q, lean: async () => stores.find((s) => orderMatches(s, filter)) ?? null };
    return q;
  };
  ProductModel.findOneAndUpdate = (filter: any, update: any) => {
    const q: any = {
      select: () => q,
      lean: async () => {
        if (failingProduct === String(filter._id)) throw new Error('product write failed');
        // The restore never filters on the trash or on being Live.
        assert.equal('deletedAt' in filter, false);
        assert.equal('isPublished' in filter, false);
        const variant = findVariant(filter);
        if (!variant) return null;
        variant.stockQuantity += update.$inc['variants.$.stockQuantity'];
        const product = products.find((p) => p._id === String(filter._id))!;
        return { variants: product.variants.map((v) => ({ ...v })) };
      },
    };
    return q;
  };
  ProductModel.exists = async (filter: any) => {
    const product = products.find((p) => p._id === String(filter._id) && p.store === String(filter.store));
    if (!product) return null;
    if (!filter.variants) return { _id: product._id };
    return product.variants.some((v) => v._id === String(filter.variants.$elemMatch._id)) ? { _id: product._id } : null;
  };
  const untouched = () => {
    throw new Error('the cancel endpoint must not read products this way');
  };
  ProductModel.find = untouched;
  ProductModel.findOne = untouched;
  MovementModel.create = async (doc: Record<string, any>) => {
    movements.push(doc);
    return doc;
  };
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
    ProductModel.findOneAndUpdate = saved.pFOAU;
    ProductModel.exists = saved.pExists;
    ProductModel.find = saved.pFind;
    ProductModel.findOne = saved.pFindOne;
    MovementModel.create = saved.mCreate;
    AuditModel.create = saved.aCreate;
  };
});

afterEach(() => {
  restore?.();
  restore = null;
});

// ---------------------------------------------------------------------------------------------------------------------
// Data and helpers

function item(productId: string, variantId: string, title: string, variantTitle: string, quantity: number, stockDeducted?: boolean) {
  return {
    productId,
    variantId,
    productTitle: title,
    variantTitle,
    sku: variantTitle === 'Default' ? null : 'SKU-' + variantTitle,
    unitPrice: 1000,
    quantity,
    ...(stockDeducted === undefined ? {} : { stockDeducted }),
  };
}

function seedOrder(status: string, fields: Record<string, any> = {}): Record<string, any> {
  const row = {
    _id: ORDER_A,
    store: STORE_A,
    orderId: 'ORD-ABCD2345',
    status,
    paymentMethod: 'cod',
    customerName: 'Sara Khan',
    items: [item(SHIRT, SHIRT_M, 'T-Shirt', 'M', 2, true)],
    subtotal: 2000,
    deliveryCharges: 0,
    total: 2000,
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
  return cancelPOST(
    new NextRequest('http://seller.test/api/orders/' + id + '/cancel', {
      method: 'POST',
      headers: h,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function cancel(id = ORDER_A, body: unknown = { reason: 'Customer asked to cancel' }, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const res = await post(id, body, token, headers);
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

const stored = (id = ORDER_A) => orders.find((row) => String(row._id) === id)!;
const units = (productId: string, variantId: string) =>
  products.find((p) => p._id === productId)!.variants.find((v) => v._id === variantId)!.stockQuantity;

function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = original;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Access and body

test('cancel: no login is 401; an admin session is 403 whatever the body', async () => {
  seedOrder('pending');
  assert.equal((await post(ORDER_A, { reason: 'Out of stock' }, null)).status, 401);
  assert.equal((await post(ORDER_A, { reason: 'Out of stock' }, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await post(ORDER_A, {}, tokenAdmin, { 'x-store-id': STORE_A })).status, 403);
  assert.equal(stored().status, 'pending');
  assert.equal(cancelWrites, 0);
});

test("cancel: seller B naming seller A's store is 403; another store's order and a bad id are 404", async () => {
  seedOrder('pending');
  seedOrder('pending', { _id: ORDER_B, store: STORE_B });
  assert.equal((await post(ORDER_A, { reason: 'Out of stock' }, tokenB, { 'x-store-id': STORE_A })).status, 403);
  assert.equal((await post(ORDER_B, { reason: 'Out of stock' })).status, 404);
  assert.equal((await post('not-an-id', { reason: 'Out of stock' })).status, 404);
  assert.equal(stored().status, 'pending');
  assert.equal(stored(ORDER_B).status, 'pending');
  assert.equal(cancelWrites, 0);
});

test('cancel: a missing, short or long reason, a long note, or a non-JSON body is 400 ORDER_BODY_INVALID', async () => {
  seedOrder('pending');
  const cases: Array<[unknown, string | null]> = [
    [{}, 'reason'],
    [{ reason: 'ab' }, 'reason'],
    [{ reason: '   no   '.repeat(1) }, 'reason'],
    [{ reason: 'x'.repeat(201) }, 'reason'],
    [{ reason: 'Out of stock', note: 'x'.repeat(501) }, 'note'],
    ['not json', null],
  ];
  for (const [body, field] of cases) {
    const res = await cancel(ORDER_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.errors[0].code, 'ORDER_BODY_INVALID');
    assert.equal(res.body.errors[0].field, field, JSON.stringify(body));
  }
  assert.equal(stored().status, 'pending');
});

test('cancel: unknown keys in the body are ignored and never stored', async () => {
  seedOrder('pending');
  const res = await cancel(ORDER_A, { reason: 'Out of stock', status: 'delivered', cancelReason: 'x', store: STORE_B, total: 1 });
  assert.equal(res.status, 200);
  assert.equal(stored().cancelReason, 'Out of stock');
  assert.equal(stored().store, STORE_A);
  assert.equal(stored().total, 2000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Which statuses

test('cancel: allowed from pending, confirmed and processing; sets status, reason, dates and one history entry', async () => {
  for (const from of ['pending', 'confirmed', 'processing']) {
    orders = [];
    audits = [];
    seedOrder(from);
    const before = Date.now();
    const { status, body, headers } = await cancel(ORDER_A, { reason: '  Customer asked to cancel  ', note: ' called twice ' });
    assert.equal(status, 200, from);
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.equal(orderCancelResponseSchema.safeParse(body).success, true, from);
    const row = stored();
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancelReason, 'Customer asked to cancel');
    assert.ok(row.cancelledAt instanceof Date && row.cancelledAt.getTime() >= before);
    assert.ok(row.stockRestoredAt instanceof Date);
    assert.equal(row.statusHistory.length, 1);
    const entry = row.statusHistory[0];
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'by', 'from', 'note', 'to']);
    assert.equal(entry.from, from);
    assert.equal(entry.to, 'cancelled');
    assert.ok(entry.by instanceof mongoose.Types.ObjectId, 'history by is the user ObjectId');
    assert.equal(String(entry.by), USER_A);
    assert.equal(entry.note, 'called twice');
    assert.equal(body.order.status, 'cancelled');
    assert.equal(body.order.canCancel, false);
    assert.deepEqual(body.order.allowedNext, []);
    assert.equal(body.order.cancelReason, 'Customer asked to cancel');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'order.cancel');
    assert.equal(audits[0].actorId, 'seller:' + USER_A);
    assert.equal(audits[0].details.from, from);
  }
});

test('cancel: dispatched, delivered and returned are refused with 422 dispatched_or_later; nothing moves', async () => {
  for (const from of ['dispatched', 'delivered', 'returned']) {
    orders = [];
    seedOrder(from);
    const { status, body } = await cancel();
    assert.equal(status, 422, from);
    assert.equal(body.errors[0].code, 'ORDER_CANCEL_ILLEGAL');
    assert.equal(body.errors[0].status, from);
    assert.equal(body.errors[0].reason, 'dispatched_or_later');
    assert.equal(stored().status, from);
  }
  assert.equal(cancelWrites, 0);
  assert.equal(units(SHIRT, SHIRT_M), 1);
  assert.equal(movements.length, 0);
});

test('cancel: an already cancelled order is 422 already_cancelled and gets no stock again', async () => {
  seedOrder('cancelled', { stockRestoredAt: new Date('2026-11-02T10:00:00Z') });
  const { status, body } = await cancel();
  assert.equal(status, 422);
  assert.equal(body.errors[0].reason, 'already_cancelled');
  assert.equal(units(SHIRT, SHIRT_M), 1);
  assert.equal(movements.length, 0);
});

test('cancel: a corrupt stored status is 422 unknown_status', async () => {
  seedOrder('shipped');
  const { status, body } = await cancel();
  assert.equal(status, 422);
  assert.equal(body.errors[0].reason, 'unknown_status');
});

// ---------------------------------------------------------------------------------------------------------------------
// Concurrency

test('cancel: two parallel cancels restore stock once; the loser gets 422 already_cancelled', async () => {
  seedOrder('pending');
  holdReads(2);
  const results = await Promise.all([cancel(), cancel()]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 422]);
  const loser = results.find((r) => r.status === 422)!;
  assert.equal(loser.body.errors[0].reason, 'already_cancelled');
  assert.equal(cancelWrites, 1);
  assert.equal(stored().statusHistory.length, 1);
  assert.equal(units(SHIRT, SHIRT_M), 3, '1 in stock + 2 back, once');
  assert.equal(movements.length, 1);
  assert.equal(audits.length, 1);
});

test('cancel: when a parallel status change lands between the read and the write the answer is 409', async () => {
  seedOrder('pending');
  holdReads(1, () => {
    stored().status = 'confirmed';
  });
  const { status, body } = await cancel();
  assert.equal(status, 409);
  assert.equal(body.errors[0].code, 'ORDER_STATUS_CHANGED');
  assert.equal(body.errors[0].status, 'confirmed');
  assert.equal(body.errors[0].canCancel, true);
  assert.equal(stored().status, 'confirmed');
  assert.equal(cancelWrites, 0);
  assert.equal(movements.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// The stock

test('cancel: variant stock goes back to the right variant, with one order_cancelled movement carrying the order id', async () => {
  seedOrder('confirmed', { items: [item(SHIRT, SHIRT_M, 'T-Shirt', 'M', 2, true)] });
  const { status, body } = await cancel();
  assert.equal(status, 200);
  assert.equal(units(SHIRT, SHIRT_M), 3);
  assert.equal(units(SHIRT, SHIRT_S), 4, 'the other size is untouched');
  assert.deepEqual(body.stockRestore, { restored: [{ name: 'T-Shirt (M)', sku: 'SKU-M', qty: 2 }], skipped: [], failed: [] });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].reason, 'order_cancelled');
  assert.equal(String(movements[0].orderId), ORDER_A);
  assert.equal(movements[0].delta, 2);
  assert.equal(movements[0].previousQuantity, 1);
  assert.equal(movements[0].quantity, 3);
  assert.equal(String(movements[0].variantId), SHIRT_M);
  assert.equal(String(movements[0].actor), USER_A);
});

test('cancel: a product with only its Default variant (product-level stock) gets its units back', async () => {
  seedOrder('pending', { items: [item(MUG, MUG_DEFAULT, 'Mug', 'Default', 3, true)] });
  const { status, body } = await cancel();
  assert.equal(status, 200);
  assert.equal(units(MUG, MUG_DEFAULT), 3);
  assert.deepEqual(body.stockRestore.restored, [{ name: 'Mug', sku: null, qty: 3 }]);
});

test('cancel: a trashed product still gets its units back', async () => {
  products.find((p) => p._id === MUG)!.deletedAt = new Date();
  products.find((p) => p._id === MUG)!.isPublished = false;
  seedOrder('pending', { items: [item(MUG, MUG_DEFAULT, 'Mug', 'Default', 2, true)] });
  const { status, body } = await cancel();
  assert.equal(status, 200);
  assert.equal(units(MUG, MUG_DEFAULT), 2);
  assert.equal(body.stockRestore.restored.length, 1);
});

test('cancel: a permanently deleted product or variant is skipped and noted in the history and the audit', async () => {
  seedOrder('processing', {
    items: [
      item(GONE, GONE_VARIANT, 'Old scarf', 'Default', 1, true),
      item(SHIRT, GONE_VARIANT, 'T-Shirt', 'XL', 1, true),
      item(SHIRT, SHIRT_S, 'T-Shirt', 'S', 1, true),
    ],
  });
  const { status, body } = await cancel();
  assert.equal(status, 200);
  assert.deepEqual(body.stockRestore.skipped, [
    { name: 'Old scarf', why: 'product_deleted' },
    { name: 'T-Shirt (XL)', why: 'variant_deleted' },
  ]);
  assert.deepEqual(body.stockRestore.restored, [{ name: 'T-Shirt (S)', sku: 'SKU-S', qty: 1 }]);
  assert.equal(units(SHIRT, SHIRT_S), 5);
  // The cancel entry, then a note entry naming what did not go back. The detail lists newest first.
  assert.equal(stored().statusHistory.length, 2);
  const note = stored().statusHistory[1];
  assert.equal(note.from, 'cancelled');
  assert.equal(note.to, 'cancelled');
  assert.equal(note.note, 'Stock not returned: Old scarf (product deleted); T-Shirt (XL) (variant deleted)');
  assert.equal(body.order.statusHistory[0].note, note.note);
  assert.equal(audits[0].details.summary, note.note);
});

test('cancel: a line whose stock was not deducted at placement is skipped and not noted', async () => {
  seedOrder('pending', { items: [item(CAP, CAP_DEFAULT, 'Cap', 'Default', 5, false), item(MUG, MUG_DEFAULT, 'Mug', 'Default', 1, true)] });
  const { status, body } = await cancel();
  assert.equal(status, 200);
  assert.deepEqual(body.stockRestore.skipped, [{ name: 'Cap', why: 'not_deducted' }]);
  assert.equal(units(CAP, CAP_DEFAULT), 0);
  assert.equal(units(MUG, MUG_DEFAULT), 1);
  assert.equal(movements.length, 1);
  assert.equal(stored().statusHistory.length, 1, 'nothing to note');
});

test('cancel: an old order without the flag restores tracked variants and skips untracked ones', async () => {
  seedOrder('confirmed', { items: [item(SHIRT, SHIRT_S, 'T-Shirt', 'S', 2), item(CAP, CAP_DEFAULT, 'Cap', 'Default', 1)] });
  const { status, body } = await cancel();
  assert.equal(status, 200);
  assert.deepEqual(body.stockRestore.restored, [{ name: 'T-Shirt (S)', sku: 'SKU-S', qty: 2 }]);
  assert.deepEqual(body.stockRestore.skipped, [{ name: 'Cap', why: 'not_tracked' }]);
  assert.equal(units(SHIRT, SHIRT_S), 6);
  assert.equal(units(CAP, CAP_DEFAULT), 0);
  assert.equal(body.order.items.every((line: any) => line.stockDeducted === null), true);
});

test('cancel: a deducted line goes back even if the variant stopped tracking quantity since', async () => {
  products.find((p) => p._id === SHIRT)!.variants[1].trackQuantity = false;
  seedOrder('pending');
  const { body } = await cancel();
  assert.deepEqual(body.stockRestore.restored, [{ name: 'T-Shirt (M)', sku: 'SKU-M', qty: 2 }]);
  assert.equal(units(SHIRT, SHIRT_M), 3);
});

test('cancel: one failing line does not block the others, and is reported and noted', async () => {
  failingProduct = SHIRT;
  seedOrder('pending', { items: [item(SHIRT, SHIRT_M, 'T-Shirt', 'M', 2, true), item(MUG, MUG_DEFAULT, 'Mug', 'Default', 1, true)] });
  const { status, body } = await quietly(() => cancel());
  assert.equal(status, 200);
  assert.deepEqual(body.stockRestore.failed, [{ name: 'T-Shirt (M)' }]);
  assert.deepEqual(body.stockRestore.restored, [{ name: 'Mug', sku: null, qty: 1 }]);
  assert.equal(units(MUG, MUG_DEFAULT), 1);
  assert.equal(stored().status, 'cancelled');
  assert.equal(stored().statusHistory[1].note, 'Stock not returned: T-Shirt (M) (could not be restored)');
});

test('cancel: a failing audit write does not fail the request', async () => {
  auditFails = true;
  seedOrder('pending');
  const { status, body } = await quietly(() => cancel());
  assert.equal(status, 200);
  assert.equal(body.order.status, 'cancelled');
  assert.equal(units(SHIRT, SHIRT_M), 3);
});

test('cancel: the response never carries idempotencyKey or requestFingerprint', async () => {
  seedOrder('pending');
  const text = await (await post(ORDER_A, { reason: 'Out of stock' })).text();
  assert.equal(text.includes('idempotencyKey'), false);
  assert.equal(text.includes('requestFingerprint'), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// The restore lib on its own

test('restore lib: names, summaries and an empty order', async () => {
  assert.equal(lineName({ productTitle: 'T-Shirt', variantTitle: 'M' }), 'T-Shirt (M)');
  assert.equal(lineName({ productTitle: 'Mug', variantTitle: 'Default' }), 'Mug');
  assert.equal(lineName({ productTitle: '', variantTitle: null }), 'Item');
  assert.equal(stockRestoreSummary({ restored: [{ name: 'A', sku: null, qty: 1 }], skipped: [{ name: 'B', why: 'not_deducted' }], failed: [] }), null);
  const long = stockRestoreSummary({ restored: [], skipped: [], failed: Array.from({ length: 50 }, (_, i) => ({ name: 'Item number ' + i })) });
  assert.ok(long && long.length <= 500);
  assert.deepEqual(await restoreOrderStock(STORE_A, ORDER_A, USER_A, []), { restored: [], skipped: [], failed: [] });
});

test('restore lib: invalid ids are skipped without a write', async () => {
  const result = await restoreOrderStock(STORE_A, ORDER_A, USER_A, [
    { productId: 'p1', variantId: 'v1', productTitle: 'Old', variantTitle: 'Default', quantity: 1 },
    { productId: SHIRT, variantId: 'v1', productTitle: 'T-Shirt', variantTitle: 'L', quantity: 1, stockDeducted: true },
  ]);
  assert.deepEqual(result.skipped, [
    { name: 'Old', why: 'product_deleted' },
    { name: 'T-Shirt (L)', why: 'variant_deleted' },
  ]);
  assert.equal(movements.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// EP-15 CB-3: the discount use goes back exactly once (A-017), through the same compare-and-set.

const DISCOUNT_ID = '65a0000000000000000e0001';
const DiscountModel = Discount as any;

const withCode = { discountCode: 'EID10', discountAmount: 200, discountSnapshot: { discountId: DISCOUNT_ID, type: 'percentage', value: 10, minOrderAmount: null } };

function stubDiscounts(rows: Array<Record<string, any>>, fail = false): { calls: () => number; undo: () => void } {
  const saved = DiscountModel.updateOne;
  let calls = 0;
  DiscountModel.updateOne = async (filter: any, update: any) => {
    calls += 1;
    if (fail) throw new Error('write failed');
    const row = rows.find((r) => String(r._id) === String(filter._id) && String(r.store) === String(filter.store));
    if (!row || !(row.usedCount > filter.usedCount.$gt)) return { matchedCount: 0 };
    row.usedCount += update.$inc.usedCount;
    return { matchedCount: 1 };
  };
  return { calls: () => calls, undo: () => (DiscountModel.updateOne = saved) };
}

const auditText = () => JSON.stringify(audits[0]);

test('cancel: a discount use goes back once, and the marker is set with the cancel', async () => {
  const row = { _id: DISCOUNT_ID, store: STORE_A, usedCount: 3 };
  const stub = stubDiscounts([row]);
  try {
    seedOrder('pending', withCode);
    assert.equal((await cancel()).status, 200);
    assert.equal(row.usedCount, 2);
    assert.ok(stored().discountRestoredAt instanceof Date);
    assert.equal(stored().discountRestoredAt, stored().stockRestoredAt, 'one write sets both');
    assert.match(auditText(), /"discountUse":"returned"/);
  } finally {
    stub.undo();
  }
});

test('cancel: cancelling twice returns the use once', async () => {
  const row = { _id: DISCOUNT_ID, store: STORE_A, usedCount: 3 };
  const stub = stubDiscounts([row]);
  try {
    seedOrder('pending', withCode);
    assert.equal((await cancel()).status, 200);
    assert.equal((await cancel()).status, 422);
    assert.equal(row.usedCount, 2);
    assert.equal(stub.calls(), 1);
  } finally {
    stub.undo();
  }
});

test('cancel: two parallel cancels return the use once', async () => {
  const row = { _id: DISCOUNT_ID, store: STORE_A, usedCount: 3 };
  const stub = stubDiscounts([row]);
  try {
    seedOrder('pending', withCode);
    holdReads(2);
    const results = await Promise.all([cancel(), cancel()]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
    assert.equal(row.usedCount, 2);
    assert.equal(stub.calls(), 1);
  } finally {
    stub.undo();
  }
});

test('cancel: a discount deleted since the order is skipped, and the cancel goes through', async () => {
  const stub = stubDiscounts([]);
  try {
    seedOrder('pending', withCode);
    assert.equal((await cancel()).status, 200);
    assert.equal(stored().status, 'cancelled');
    assert.match(auditText(), /"discountUse":"skipped"/);
  } finally {
    stub.undo();
  }
});

test('cancel: an archived discount still gets its use back', async () => {
  const row = { _id: DISCOUNT_ID, store: STORE_A, usedCount: 1, archivedAt: new Date() };
  const stub = stubDiscounts([row]);
  try {
    seedOrder('pending', withCode);
    assert.equal((await cancel()).status, 200);
    assert.equal(row.usedCount, 0);
  } finally {
    stub.undo();
  }
});

test('cancel: an order without a code touches no discount and sets no marker', async () => {
  const stub = stubDiscounts([{ _id: DISCOUNT_ID, store: STORE_A, usedCount: 3 }]);
  try {
    seedOrder('pending');
    assert.equal((await cancel()).status, 200);
    assert.equal(stub.calls(), 0);
    assert.equal('discountRestoredAt' in stored(), false);
    assert.match(auditText(), /"discountUse":null/);
  } finally {
    stub.undo();
  }
});

test('cancel: the use count never goes below zero', async () => {
  const row = { _id: DISCOUNT_ID, store: STORE_A, usedCount: 0 };
  const stub = stubDiscounts([row]);
  try {
    seedOrder('pending', withCode);
    assert.equal((await cancel()).status, 200);
    assert.equal(row.usedCount, 0);
  } finally {
    stub.undo();
  }
});

test("cancel: another store's discount with the same id is not credited", async () => {
  const row = { _id: DISCOUNT_ID, store: STORE_B, usedCount: 3 };
  const stub = stubDiscounts([row]);
  try {
    seedOrder('pending', withCode);
    assert.equal((await cancel()).status, 200);
    assert.equal(row.usedCount, 3);
  } finally {
    stub.undo();
  }
});

test('cancel: a discount write that fails does not stop the cancel, and is on the record', async () => {
  const stub = stubDiscounts([], true);
  const quiet = console.error;
  console.error = () => undefined;
  try {
    seedOrder('pending', withCode);
    assert.equal((await cancel()).status, 200);
    assert.equal(stored().status, 'cancelled');
    assert.equal(units(SHIRT, SHIRT_M), 3, 'stock still went back');
    assert.match(auditText(), /"discountUse":"failed"/);
  } finally {
    console.error = quiet;
    stub.undo();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// EP-03 CB-5: card orders and the hand cancel.

const SESSION = 'cs_test_cancel';
const unpaidCard = { paymentMethod: 'card', paymentStatus: 'unpaid', stripeSessionId: SESSION };

async function withStripe(run: (state: { expired: string[]; warned: unknown[][]; failed: unknown[][]; expire: (id: string) => Promise<unknown>; session: Record<string, unknown> }) => Promise<void>): Promise<void> {
  process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_stub';
  process.env.STOREFRONT_URL = 'https://markazify.test';
  const sessions = (await stripeClient()).checkout.sessions as any;
  const saved = { expire: sessions.expire, retrieve: sessions.retrieve, warn: console.warn, error: console.error };
  const state = { expired: [] as string[], warned: [] as unknown[][], failed: [] as unknown[][], expire: async (_id: string): Promise<unknown> => ({ status: 'expired' }), session: { payment_status: 'unpaid' } as Record<string, unknown> };
  sessions.expire = async (id: string) => {
    state.expired.push(id);
    return state.expire(id);
  };
  sessions.retrieve = async () => state.session;
  console.warn = (...args: unknown[]) => void state.warned.push(args);
  console.error = (...args: unknown[]) => void state.failed.push(args);
  try {
    await run(state);
  } finally {
    sessions.expire = saved.expire;
    sessions.retrieve = saved.retrieve;
    console.warn = saved.warn;
    console.error = saved.error;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_ORDER_WEBHOOK_SECRET;
    delete process.env.STOREFRONT_URL;
  }
}

test('cancel: a seller cancelling an unpaid card order also expires its Stripe session', () =>
  withStripe(async (state) => {
    seedOrder('pending', unpaidCard);
    assert.equal((await cancel()).status, 200);
    assert.deepEqual(state.expired, [SESSION]);
    assert.equal(state.failed.length, 0);
  }));

test('cancel: an order with no session, or cash on delivery, asks Stripe nothing', () =>
  withStripe(async (state) => {
    seedOrder('pending', { paymentMethod: 'card', paymentStatus: 'unpaid', stripeSessionId: null });
    assert.equal((await cancel()).status, 200);
    orders = [];
    seedOrder('pending', { paymentMethod: 'cod' });
    assert.equal((await cancel()).status, 200);
    assert.deepEqual(state.expired, []);
  }));

test('cancel: if Stripe says the session was already paid, it is logged as needing a refund and the cancel stands', () =>
  withStripe(async (state) => {
    state.expire = async () => {
      throw Object.assign(new Error('not open'), { code: 'checkout_session_not_open' });
    };
    state.session = { payment_status: 'paid' };
    seedOrder('pending', unpaidCard);
    assert.equal((await cancel()).status, 200);
    assert.equal(stored().status, 'cancelled');
    assert.match(String(state.failed[0]?.[0]), /needs a refund/);
  }));

test('cancel: a Stripe failure does not fail the cancel, and is logged', () =>
  withStripe(async (state) => {
    state.expire = async () => {
      throw Object.assign(new Error('secret detail'), { code: 'api_error' });
    };
    seedOrder('pending', unpaidCard);
    assert.equal((await cancel()).status, 200);
    assert.equal(stored().status, 'cancelled');
    assert.equal(state.warned.length, 1);
    assert.equal(JSON.stringify(state.warned).includes('secret detail'), false);
  }));

test('cancel: a refused cancel does not touch the session', () =>
  withStripe(async (state) => {
    seedOrder('dispatched', unpaidCard);
    assert.equal((await cancel()).status, 422);
    assert.deepEqual(state.expired, []);
  }));

test('cancel: a paid card order cannot be cancelled by hand, and says refunds come later', async () => {
  seedOrder('pending', { paymentMethod: 'card', paymentStatus: 'paid' });
  const { status, body } = await cancel();
  assert.equal(status, 422);
  assert.equal(body.errors[0].code, 'ORDER_CANCEL_ILLEGAL');
  assert.equal(body.errors[0].reason, 'card_paid');
  assert.match(body.errors[0].message, /Refunds/);
  assert.equal(stored().status, 'pending');
  assert.equal(cancelWrites, 0);
});

test('cancel: a payment landing between the read and the write still blocks the cancel', async () => {
  seedOrder('pending', { paymentMethod: 'card', paymentStatus: 'unpaid' });
  const write = OrderModel.findOneAndUpdate;
  OrderModel.findOneAndUpdate = (filter: any, update: any, options: any) => {
    stored().paymentStatus = 'paid';
    return write(filter, update, options);
  };
  const { status, body } = await cancel();
  assert.equal(status, 422);
  assert.equal(body.errors[0].reason, 'card_paid');
  assert.equal(stored().status, 'pending');
});

test('cancel: a paid cash on delivery order is unaffected by the card rule', async () => {
  seedOrder('pending', { paymentMethod: 'cod', paymentStatus: 'collected' });
  assert.equal((await cancel()).status, 200);
});

test('detail: a paid card order offers no cancel; the customer email, WhatsApp and note are shown', () => {
  const paid = toDashboardOrderDetail({ _id: ORDER_A, orderId: 'ORD-1', status: 'pending', paymentMethod: 'card', paymentStatus: 'paid' });
  assert.equal(paid.canCancel, false);
  const unpaid = toDashboardOrderDetail({ _id: ORDER_A, orderId: 'ORD-1', status: 'pending', paymentMethod: 'card', paymentStatus: 'unpaid', customerEmail: 'sara@example.pk', customerWhatsapp: '+923117654321', customerNote: 'Ring the bell', notes: [] });
  assert.equal(unpaid.canCancel, true);
  assert.equal(unpaid.customerEmail, 'sara@example.pk');
  assert.equal(unpaid.customerWhatsapp, '+923117654321');
  assert.equal(unpaid.customerNote, 'Ring the bell');
  assert.deepEqual(unpaid.notes, [], "the shopper's note is not one of the seller's notes");
});
