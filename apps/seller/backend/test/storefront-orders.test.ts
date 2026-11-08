import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Order, Product, StockMovement, Store } from '@/lib/services';
import { storefrontOrderCreatedResponseSchema, storefrontOrderLookupResponseSchema } from '@/lib/contracts';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';

const STORE_ID = '65a000000000000000000011';
const OTHER_STORE_ID = '65a000000000000000000012';
const SHIRT = '65a0000000000000000000b1';
const MUG = '65a0000000000000000000b2';
const DRAFT = '65a0000000000000000000b3';
const FOREIGN = '65a0000000000000000000b4';
const DEMO = '65a0000000000000000000b5';
const TRASHED = '65a0000000000000000000b6';
const GHOST = '65a0000000000000000000ff';

const StoreModel = Store as any;
const ProductModel = Product as any;
const OrderModel = Order as any;
const MovementModel = StockMovement as unknown as { create: (doc: Record<string, unknown>) => Promise<unknown> };

let createPOST: (r: NextRequest, c: any) => Promise<Response>;
let lookupPOST: (r: NextRequest, c: any) => Promise<Response>;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  createPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/route')).POST;
  lookupPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/lookup/route')).POST;
});

/* ----------------------------- an in-memory world behind the models ----------------------------- */

let storeRow: Record<string, any> | null;
let products: Map<string, Record<string, any>>;
let orders: Array<Record<string, any>>;
let movements: Array<Record<string, unknown>>;
let reads: { staleOrderReads: number; afterProductFind?: () => void };
let createError: Error | null;
let connectFails: boolean;
let restore: () => void;

/** connectSellerDb caches its first successful connection per process; an outage test has to drop that cache first. */
function simulateOutage(): void {
  const cache = (globalThis as any).__sellerMongo;
  if (cache) cache.promise = null;
}

function dupKeyError(keyPattern: Record<string, number>) {
  return Object.assign(new Error('E11000 duplicate key error'), { code: 11000, keyPattern });
}

beforeEach(() => {
  resetRateLimits();
  storeRow = activeStore();
  products = new Map(
    [
      product(SHIRT, { title: 'Blue shirt', price: 1500, stockQuantity: 10, deliveryCharge: null }),
      product(MUG, { title: 'Mug', price: 400, stockQuantity: 3, deliveryCharge: 100 }),
      product(DRAFT, { title: 'Draft', price: 100, stockQuantity: 5, isPublished: false }),
      product(FOREIGN, { title: 'Foreign', price: 100, stockQuantity: 5, store: OTHER_STORE_ID }),
      product(DEMO, { title: 'Demo', price: 100, stockQuantity: 5, isDemo: true }),
      product(TRASHED, { title: 'Trashed', price: 100, stockQuantity: 5, deletedAt: new Date() }),
    ].map((p) => [p._id, p]),
  );
  orders = [];
  movements = [];
  reads = { staleOrderReads: 0 };
  createError = null;
  connectFails = false;

  const saved = {
    connect: (mongoose as any).connect,
    sFindById: StoreModel.findById,
    pFind: ProductModel.find,
    pFOAU: ProductModel.findOneAndUpdate,
    pExists: ProductModel.exists,
    mCreate: MovementModel.create,
    oFindOne: OrderModel.findOne,
    oCreate: OrderModel.create,
  };

  (mongoose as any).connect = async () => {
    if (connectFails) throw new Error('down');
    return mongoose;
  };
  StoreModel.findById = () => {
    const q: any = { select: () => q, lean: async () => storeRow };
    return q;
  };

  ProductModel.find = (filter: any) => {
    const ids: string[] = filter._id.$in;
    const q: any = {
      select: () => q,
      lean: async () => {
        const rows = ids
          .map((id) => products.get(id.toLowerCase()))
          .filter((p): p is Record<string, any> => !!p && String(p.store) === String(filter.store))
          .map((p) => structuredClone(p));
        reads.afterProductFind?.();
        return rows;
      },
    };
    return q;
  };

  // The conditional write: matches only while that one variant still covers the quantity.
  const matchVariant = (filter: VariantFilter): Record<string, unknown> | null => {
    const p = products.get(String(filter._id).toLowerCase());
    if (!p || String(p.store) !== String(filter.store)) return null;
    if (filter.isPublished !== undefined && p.isPublished !== filter.isPublished) return null;
    if (filter.deletedAt === null && p.deletedAt) return null;
    if (filter.isDemo !== undefined && p.isDemo === true) return null;
    const wanted = filter.variants.$elemMatch;
    const variant: Record<string, unknown> | undefined = p.variants.find(
      (candidate: Record<string, unknown>) => String(candidate._id).toLowerCase() === wanted._id.toLowerCase(),
    );
    if (!variant) return null;
    if (wanted.trackQuantity !== undefined && variant.trackQuantity !== wanted.trackQuantity) return null;
    if (wanted.stockQuantity && Number(variant.stockQuantity) < wanted.stockQuantity.$gte) return null;
    return variant;
  };
  ProductModel.findOneAndUpdate = (filter: VariantFilter, update: { $inc: Record<string, number> }) => {
    const q: { select: () => typeof q; lean: () => Promise<unknown> } = {
      select: () => q,
      lean: async () => {
        const variant = matchVariant(filter);
        if (!variant) return null;
        variant.stockQuantity = Number(variant.stockQuantity) + update.$inc['variants.$.stockQuantity'];
        return { variants: products.get(String(filter._id).toLowerCase())!.variants };
      },
    };
    return q;
  };
  ProductModel.exists = async (filter: VariantFilter) => matchVariant(filter);
  MovementModel.create = async (doc) => {
    movements.push(doc);
    return doc;
  };

  OrderModel.findOne = (filter: any) => {
    const q: any = {
      lean: async () => {
        if (filter.idempotencyKey !== undefined && reads.staleOrderReads > 0) {
          reads.staleOrderReads -= 1;
          return null;
        }
        const hit = orders.find((o) => Object.entries(filter).every(([k, v]) => String(o[k]) === String(v)));
        return hit ? structuredClone(hit) : null;
      },
    };
    return q;
  };
  OrderModel.create = async (doc: any) => {
    await Promise.resolve();
    if (createError) throw createError;
    if (orders.some((o) => String(o.store) === String(doc.store) && o.idempotencyKey === doc.idempotencyKey)) {
      throw dupKeyError({ store: 1, idempotencyKey: 1 });
    }
    if (orders.some((o) => String(o.store) === String(doc.store) && o.orderId === doc.orderId)) {
      throw dupKeyError({ store: 1, orderId: 1 });
    }
    const now = new Date('2026-10-14T10:00:00.000Z');
    const saved = { _id: '65a0000000000000000a' + String(orders.length).padStart(4, '0'), ...structuredClone(doc), createdAt: now, updatedAt: now };
    orders.push(saved);
    return saved;
  };

  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.findById = saved.sFindById;
    ProductModel.find = saved.pFind;
    ProductModel.findOneAndUpdate = saved.pFOAU;
    ProductModel.exists = saved.pExists;
    MovementModel.create = saved.mCreate;
    OrderModel.findOne = saved.oFindOne;
    OrderModel.create = saved.oCreate;
  };
});

afterEach(() => restore());

function activeStore(sf: Record<string, any> = {}, pay: Record<string, any> = {}) {
  return {
    _id: STORE_ID,
    status: 'active',
    storefront: { deliveryRate: 250, freeDeliveryThreshold: 5000, ...sf },
    paymentSettings: { codEnabled: true, cardEnabled: false, ...pay },
  };
}

interface VariantFilter {
  _id: string;
  store: string;
  isPublished?: boolean;
  isDemo?: { $ne: boolean };
  deletedAt?: null;
  variants: { $elemMatch: { _id: string; trackQuantity?: boolean; stockQuantity?: { $gte: number } } };
}

const VARIANT_OF: Record<string, string> = {};

/** Every fixture is a product with one Default variant unless it brings its own variants. */
function product(id: string, { price, stockQuantity, ...overrides }: Record<string, unknown>) {
  const variantId = id.slice(0, -2) + 'e' + id.slice(-1);
  VARIANT_OF[id] = variantId;
  const defaults = { _id: variantId, title: 'Default', sku: null, price, trackQuantity: true, stockQuantity, lowStockThreshold: null };
  return { _id: id, store: STORE_ID, isPublished: true, variants: [defaults], ...overrides };
}

const variant = (id: string): Record<string, unknown> => products.get(id)!.variants[0];

const CUSTOMER = { customerName: 'Sara Khan', phone: '0300 1234567', address: 'House 12, Street 4, Block 5' };
let keySeq = 0;
const newKey = () => 'idem-test-' + String(++keySeq).padStart(6, '0');

function post(handler: typeof createPOST, id: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = new NextRequest('http://localhost/api/storefront/v1/stores/' + id + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw,
  });
  return handler(req, { params: Promise.resolve({ id }) });
}

const order = (body: Record<string, any> = {}, headers: Record<string, string> = { 'idempotency-key': newKey() }, id = STORE_ID) =>
  post(createPOST, id, '/orders', { customer: CUSTOMER, lines: [{ productId: SHIRT, qty: 2 }], ...body }, headers);

const lookup = (body: unknown, headers: Record<string, string> = {}, id = STORE_ID) => post(lookupPOST, id, '/orders/lookup', body, headers);

const stock = (id: string) => variant(id).stockQuantity as number;

/* ------------------------------------------- create ------------------------------------------- */

const line = (id: string, title: string, unitPrice: number, quantity: number) => ({
  productId: id,
  variantId: VARIANT_OF[id],
  productTitle: title,
  variantTitle: 'Default',
  sku: null,
  unitPrice,
  quantity,
});

test('creates an order: server totals, stock taken, customer and key saved, contract-valid, uncached', async () => {
  const key = newKey();
  const res = await order({ customer: { ...CUSTOMER, city: 'Karachi' } }, { 'idempotency-key': key });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('idempotent-replayed'), null);

  const body = await res.json();
  assert.equal(storefrontOrderCreatedResponseSchema.safeParse(body).success, true);
  // 2 x 1500 = 3000, below the 5000 threshold, store rate 250.
  assert.equal(body.data.subtotal, 3000);
  assert.equal(body.data.deliveryCharges, 250);
  assert.equal(body.data.total, 3250);
  assert.equal(body.data.status, 'pending');
  assert.equal(body.data.paymentMethod, 'cod');
  assert.match(body.data.orderId, /^ORD-[A-Z0-9]{8}$/);

  assert.equal(stock(SHIRT), 8);
  assert.equal(orders.length, 1);
  const saved = orders[0];
  assert.equal(String(saved.store), STORE_ID);
  assert.equal(saved.idempotencyKey, key);
  assert.equal(saved.customerName, 'Sara Khan');
  assert.equal(saved.phone, '+923001234567', 'phone is stored as E.164');
  assert.equal(saved.address, CUSTOMER.address);
  assert.equal(saved.city, 'Karachi');
  assert.equal(saved.paymentMethod, 'cod');
  assert.ok(saved.orderGroupId);
  assert.ok(saved.requestFingerprint);
  assert.deepEqual(saved.items, [line(SHIRT, 'Blue shirt', 1500, 2)]);
});

test('the Idempotency-Key header is accepted, and so is body.idempotencyKey', async () => {
  const viaBody = await order({ idempotencyKey: 'body-key-0001' }, {});
  assert.equal(viaBody.status, 201);
  assert.equal(orders[0].idempotencyKey, 'body-key-0001');

  const both = await order({ idempotencyKey: 'body-key-0002' }, { 'idempotency-key': 'header-key-0002' });
  assert.equal(both.status, 201);
  assert.equal(orders[1].idempotencyKey, 'header-key-0002', 'the header wins');
});

test('prices and totals sent by the client are ignored: the catalog decides', async () => {
  const res = await post(
    createPOST,
    STORE_ID,
    '/orders',
    {
      customer: CUSTOMER,
      lines: [{ productId: SHIRT, qty: 2, price: 1, unitPrice: 1, total: 1 }],
      subtotal: 1,
      deliveryCharges: 0,
      total: 1,
    },
    { 'idempotency-key': newKey() },
  );
  assert.equal(res.status, 201);
  const { data } = await res.json();
  assert.equal(data.total, 3250);
  assert.equal(orders[0].items[0].unitPrice, 1500);
  assert.equal(orders[0].total, 3250);
});

test('a price change between cart and checkout is honoured at checkout price', async () => {
  variant(SHIRT).price = 1700;
  const { data } = await (await order()).json();
  assert.equal(data.subtotal, 3400);
});

test('delivery: free at the threshold, product charge applies to a small order', async () => {
  // 4 x 1500 = 6000 >= 5000: free.
  const free = await (await order({ lines: [{ productId: SHIRT, qty: 4 }] })).json();
  assert.equal(free.data.deliveryCharges, 0);
  assert.equal(free.data.total, 6000);

  // A mug (own charge 100) alone: 400 + 100.
  const mug = await (await order({ lines: [{ productId: MUG, qty: 1 }] })).json();
  assert.equal(mug.data.deliveryCharges, 100);
  assert.equal(mug.data.total, 500);

  // Shirt (store rate 250) with a mug (100): one parcel pays the highest, 250.
  const mixed = await (await order({ lines: [{ productId: SHIRT, qty: 1 }, { productId: MUG, qty: 1 }] })).json();
  assert.equal(mixed.data.deliveryCharges, 250);
  assert.equal(mixed.data.total, 1900 + 250);
});

test('the same product on two lines is one line with the summed quantity', async () => {
  const res = await order({ lines: [{ productId: SHIRT, qty: 2 }, { productId: SHIRT.toUpperCase(), qty: 3 }] });
  assert.equal(res.status, 201);
  assert.deepEqual(orders[0].items, [line(SHIRT, 'Blue shirt', 1500, 5)]);
  assert.equal(stock(SHIRT), 5);
});

test('a stock movement records the sale', async () => {
  await order();
  assert.equal(movements.length, 1);
  assert.equal(movements[0].reason, 'storefront_order');
  assert.equal(movements[0].quantity, 8);
  assert.equal(movements[0].previousQuantity, 10);
  assert.equal(movements[0].delta, -2);
  assert.equal(movements[0].variantId, VARIANT_OF[SHIRT]);
  assert.equal(String(movements[0].store), STORE_ID);
});

test('taking the last units leaves the next shopper out of stock', async () => {
  const res = await order({ lines: [{ productId: MUG, qty: 3 }] });
  assert.equal(res.status, 201);
  assert.equal(stock(MUG), 0);
  assert.equal((await order({ lines: [{ productId: MUG, qty: 1 }] })).status, 409);
});

/* ---------------------------------------- idempotency ---------------------------------------- */

test('a retry with the same key returns the first order: 200, replay header, no new order, stock moved once', async () => {
  const key = newKey();
  const first = await order({}, { 'idempotency-key': key });
  const second = await order({}, { 'idempotency-key': key });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('idempotent-replayed'), 'true');

  const a = await first.json();
  const b = await second.json();
  assert.deepEqual(b, a);
  assert.equal(orders.length, 1);
  assert.equal(stock(SHIRT), 8);
});

test('a replay does not re-price: it returns the original total even after a price change', async () => {
  const key = newKey();
  const a = await (await order({}, { 'idempotency-key': key })).json();
  variant(SHIRT).price = 9999;
  const b = await (await order({}, { 'idempotency-key': key })).json();
  assert.equal(b.data.total, a.data.total);
});

test('a replay still works after the product sold out (no stock check on replay)', async () => {
  const key = newKey();
  await order({ lines: [{ productId: MUG, qty: 3 }] }, { 'idempotency-key': key });
  assert.equal(stock(MUG), 0);
  const again = await order({ lines: [{ productId: MUG, qty: 3 }] }, { 'idempotency-key': key });
  assert.equal(again.status, 200);
});

test('a key reused for a different order is 409 IDEMPOTENCY_CONFLICT and changes nothing', async () => {
  const key = newKey();
  await order({}, { 'idempotency-key': key });
  const res = await order({ lines: [{ productId: MUG, qty: 1 }] }, { 'idempotency-key': key });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(orders.length, 1);
  assert.equal(stock(MUG), 3);
});

test('the key is scoped to the store: a key held by another store is not a replay here', async () => {
  const key = newKey();
  orders.push({ store: OTHER_STORE_ID, idempotencyKey: key, orderId: 'ORD-OTHER000', requestFingerprint: 'x' });
  const res = await order({}, { 'idempotency-key': key });
  assert.equal(res.status, 201);
  assert.equal(orders.length, 2);
});

test('two simultaneous submissions with one key save one order and take stock once', async () => {
  // Both requests read "no order yet" before either writes: the unique index has to decide.
  reads.staleOrderReads = 2;
  const key = newKey();
  const [a, b] = await Promise.all([order({}, { 'idempotency-key': key }), order({}, { 'idempotency-key': key })]);

  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  const [bodyA, bodyB] = [await a.json(), await b.json()];
  assert.equal(bodyA.data.orderId, bodyB.data.orderId);
  assert.equal(orders.length, 1);
  assert.equal(stock(SHIRT), 8, 'the losing request gave its units back');
});

test('an order-id collision is retried with a fresh id', async () => {
  let first = true;
  const realCreate = OrderModel.create;
  OrderModel.create = async (doc: any) => {
    if (first) {
      first = false;
      throw dupKeyError({ store: 1, orderId: 1 });
    }
    return realCreate(doc);
  };
  const res = await order();
  assert.equal(res.status, 201);
  assert.equal(orders.length, 1);
  assert.equal(stock(SHIRT), 8, 'one collision does not take stock twice');
});

/* ------------------------------------------ stock ------------------------------------------ */

test('asking for more than is available is 409 OUT_OF_STOCK with the product, and nothing changes', async () => {
  const res = await order({ lines: [{ productId: MUG, qty: 4 }] });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, 'OUT_OF_STOCK');
  assert.equal(body.productId, MUG);
  assert.equal(orders.length, 0);
  assert.equal(stock(MUG), 3);
});

test('the first problem line is the one reported', async () => {
  const res = await order({ lines: [{ productId: SHIRT, qty: 1 }, { productId: MUG, qty: 50 }] });
  assert.equal((await res.json()).productId, MUG);
  assert.equal(stock(SHIRT), 10);
});

test('losing a stock race on a later line gives back the lines already taken', async () => {
  // The pre-check passes, then someone else buys every mug before this order reserves them.
  reads.afterProductFind = () => {
    variant(MUG).stockQuantity = 0;
  };
  const res = await order({ lines: [{ productId: SHIRT, qty: 2 }, { productId: MUG, qty: 1 }] });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).productId, MUG);
  assert.equal(stock(SHIRT), 10, 'the shirts reserved first were released');
  assert.equal(orders.length, 0);
});

test('stock is never taken twice for one order, and never goes negative under contention', async () => {
  // Five shoppers, each wants 2 of the 3 mugs: exactly one can win.
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(() => order({ lines: [{ productId: MUG, qty: 2 }] }, { 'idempotency-key': newKey() })),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.equal(statuses.filter((s) => s === 201).length, 1);
  assert.equal(statuses.filter((s) => s === 409).length, 4);
  assert.equal(stock(MUG), 1);
  assert.equal(orders.length, 1);
});

test('if saving the order fails, the stock is given back and the client gets a 500', async () => {
  createError = new Error('disk full');
  const original = console.error;
  console.error = () => {};
  try {
    const res = await order();
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'INTERNAL_ERROR');
  } finally {
    console.error = original;
  }
  assert.equal(stock(SHIRT), 10);
  assert.equal(orders.length, 0);
});

/* ---------------------------------------- bad products ---------------------------------------- */

test('a draft, an unedited demo and a trashed product are 422 PRODUCT_UNAVAILABLE, and no stock moves (D-037)', async () => {
  for (const productId of [DRAFT, DEMO, TRASHED]) {
    const res = await order({ lines: [{ productId: SHIRT, qty: 1 }, { productId, qty: 1 }] });
    assert.equal(res.status, 422, productId);
    const body = await res.json();
    assert.equal(body.error.code, 'PRODUCT_UNAVAILABLE');
    assert.equal(body.productId, productId);
  }
  assert.equal(orders.length, 0);
  assert.equal(variant(SHIRT).stockQuantity, 10);
});

test('a product trashed after the order was priced is refused at the stock write, and earlier lines are given back', async () => {
  reads.afterProductFind = () => {
    products.get(MUG)!.deletedAt = new Date();
  };
  const res = await order({ lines: [{ productId: SHIRT, qty: 1 }, { productId: MUG, qty: 1 }] });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'PRODUCT_UNAVAILABLE');
  assert.equal(orders.length, 0);
  assert.equal(variant(SHIRT).stockQuantity, 10);
});

test('an order keeps its own snapshot after the product is gone from the catalog', async () => {
  assert.equal((await order({ lines: [{ productId: SHIRT, qty: 1 }] })).status, 201);
  products.delete(SHIRT);
  const item = orders[0].items[0];
  assert.equal(item.productTitle, 'Blue shirt');
  assert.equal(item.variantTitle, 'Default');
  assert.equal(item.unitPrice, 1500);
  assert.equal(item.quantity, 1);
});

test('an unknown, foreign, or malformed product id is 422 UNKNOWN_PRODUCT', async () => {
  for (const productId of [GHOST, FOREIGN, 'not-an-object-id']) {
    const res = await order({ lines: [{ productId, qty: 1 }] });
    assert.equal(res.status, 422, productId);
    const body = await res.json();
    assert.equal(body.error.code, 'UNKNOWN_PRODUCT');
    assert.equal(body.productId, productId);
  }
  assert.equal(orders.length, 0);
});

/* ------------------------------------------ validation ------------------------------------------ */

test('an empty cart is 400 EMPTY_ORDER', async () => {
  const res = await order({ lines: [] });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'EMPTY_ORDER');
});

test('a bad quantity is 400 INVALID_QUANTITY with the product', async () => {
  for (const qty of [0, -1, 1.5, 100]) {
    const res = await order({ lines: [{ productId: SHIRT, qty }] });
    assert.equal(res.status, 400, String(qty));
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_QUANTITY');
    assert.equal(body.productId, SHIRT);
  }
  // Two lines that are each fine but add up past the cap.
  const merged = await order({ lines: [{ productId: SHIRT, qty: 60 }, { productId: SHIRT, qty: 60 }] });
  assert.equal(merged.status, 400);
  assert.equal((await merged.json()).error.code, 'INVALID_QUANTITY');
});

test('an Idempotency-Key is required and must be well formed', async () => {
  const missing = await order({}, {});
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, 'INVALID_REQUEST');
  for (const bad of ['short', 'has space in it!', 'x'.repeat(129)]) {
    assert.equal((await order({}, { 'idempotency-key': bad })).status, 400, bad);
  }
});

test('customer details are validated: phone, name, address', async () => {
  const cases: Array<Record<string, any>> = [
    { ...CUSTOMER, phone: '12345' },
    { ...CUSTOMER, phone: '+14155550123' },
    { ...CUSTOMER, customerName: 'A' },
    { ...CUSTOMER, address: 'short' },
  ];
  for (const customer of cases) {
    const res = await order({ customer });
    assert.equal(res.status, 400, JSON.stringify(customer));
    assert.equal((await res.json()).error.code, 'INVALID_REQUEST');
  }
  assert.equal(orders.length, 0);
});

test('every Pakistani phone format is stored as E.164', async () => {
  for (const phone of ['03001234567', '3001234567', '+92 300 1234567', '0092-300-1234567']) {
    await order({ customer: { ...CUSTOMER, phone } });
  }
  assert.deepEqual([...new Set(orders.map((o) => o.phone))], ['+923001234567']);
});

test('a malformed or oversized body is 400, never 500', async () => {
  const notJson = await post(createPOST, STORE_ID, '/orders', '{nope', { 'idempotency-key': newKey() });
  assert.equal(notJson.status, 400);
  const empty = await post(createPOST, STORE_ID, '/orders', '', { 'idempotency-key': newKey() });
  assert.equal(empty.status, 400);
  const wrongShape = await post(createPOST, STORE_ID, '/orders', { hello: 'world' }, { 'idempotency-key': newKey() });
  assert.equal(wrongShape.status, 400);
  const huge = await post(createPOST, STORE_ID, '/orders', { customer: CUSTOMER, lines: [], pad: 'x'.repeat(40_000) }, { 'idempotency-key': newKey() });
  assert.equal(huge.status, 400);
});

test('card payment is refused, and so is cash on delivery when the store turned it off', async () => {
  const card = await order({ paymentMethod: 'card' });
  assert.equal(card.status, 400);
  assert.equal((await card.json()).error.code, 'PAYMENT_METHOD_UNAVAILABLE');

  storeRow = activeStore({}, { codEnabled: false });
  const cod = await order();
  assert.equal(cod.status, 400);
  assert.equal((await cod.json()).error.code, 'PAYMENT_METHOD_UNAVAILABLE');
  assert.equal(orders.length, 0);
  assert.equal(stock(SHIRT), 10);
});

/* ------------------------------------------- the store ------------------------------------------- */

test('a malformed or unknown store is 404 STORE_NOT_FOUND', async () => {
  assert.equal((await order({}, { 'idempotency-key': newKey() }, 'nope')).status, 404);
  storeRow = null;
  const res = await order();
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'STORE_NOT_FOUND');
});

test('a store that is not active takes no orders', async () => {
  storeRow = { ...activeStore(), status: 'pending' };
  const res = await order();
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'STORE_NOT_ACTIVE');
  assert.equal(body.status, 'pending');
  assert.equal(stock(SHIRT), 10);
});

test('a database outage is 503', async () => {
  simulateOutage();
  connectFails = true;
  assert.equal((await order()).status, 503);
});

test('creating orders is rate limited per client, with Retry-After', async () => {
  const headers = () => ({ 'idempotency-key': newKey(), 'x-forwarded-for': '203.0.113.9' });
  let last: Response | null = null;
  for (let i = 0; i < 21; i += 1) last = await order({ lines: [{ productId: GHOST, qty: 1 }] }, headers());
  assert.equal(last!.status, 429);
  assert.equal((await last!.json()).error.code, 'RATE_LIMITED');
  assert.ok(Number(last!.headers.get('retry-after')) >= 1);

  // A different client is not affected.
  const other = await order({}, { 'idempotency-key': newKey(), 'x-forwarded-for': '198.51.100.7' });
  assert.equal(other.status, 201);
});

/* ------------------------------------------- lookup ------------------------------------------- */

async function placed(overrides: Record<string, any> = {}) {
  const res = await order(overrides);
  return (await res.json()).data.orderId as string;
}

test('lookup returns the order for the right order id and phone, in any phone format', async () => {
  const orderId = await placed({ customer: { ...CUSTOMER, city: 'Lahore' } });
  for (const phone of ['03001234567', '+923001234567', '0300-1234567', '923001234567']) {
    const res = await lookup({ orderId, phone });
    assert.equal(res.status, 200, phone);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(storefrontOrderLookupResponseSchema.safeParse(body).success, true);
    assert.equal(body.data.orderId, orderId);
    assert.equal(body.data.status, 'pending');
    assert.equal(body.data.total, 3250);
    assert.equal(body.data.customerName, 'Sara Khan');
    assert.equal(body.data.city, 'Lahore');
    assert.deepEqual(body.data.items, [
      { productId: SHIRT, variantId: VARIANT_OF[SHIRT], title: 'Blue shirt', variantTitle: 'Default', unitPrice: 1500, qty: 2, lineTotal: 3000 },
    ]);
  }
});

test('lookup exposes no internal fields', async () => {
  const orderId = await placed();
  const text = JSON.stringify(await (await lookup({ orderId, phone: '03001234567' })).json());
  for (const hidden of ['idempotencyKey', 'requestFingerprint', 'orderGroupId', 'store', '_id', STORE_ID]) {
    assert.equal(text.includes(hidden), false, hidden);
  }
});

test('lookup tolerates a lowercase order id and a missing prefix', async () => {
  const orderId = await placed();
  assert.equal((await lookup({ orderId: orderId.toLowerCase(), phone: '03001234567' })).status, 200);
  assert.equal((await lookup({ orderId: orderId.replace('ORD-', ''), phone: '03001234567' })).status, 200);
});

test('a wrong phone, an unknown order, and another store all give the same 404', async () => {
  const orderId = await placed();
  const wrongPhone = await lookup({ orderId, phone: '03009999999' });
  const unknown = await lookup({ orderId: 'ORD-ZZZZZZZZ', phone: '03001234567' });
  assert.equal(wrongPhone.status, 404);
  assert.equal(unknown.status, 404);
  const a = await wrongPhone.json();
  const b = await unknown.json();
  assert.deepEqual(a, b);
  assert.equal(a.error.code, 'ORDER_NOT_FOUND');

  // The same order id asked of another store.
  storeRow = { ...activeStore(), _id: OTHER_STORE_ID };
  const foreign = await lookup({ orderId, phone: '03001234567' }, {}, OTHER_STORE_ID);
  assert.equal(foreign.status, 404);
  assert.deepEqual(await foreign.json(), a);
});

test('an older order with a local-format phone can still be tracked', async () => {
  orders.push({
    store: STORE_ID,
    orderId: 'ORD-LEGACY01',
    status: 'dispatched',
    phone: '0300-1234567',
    customerName: 'Old Customer',
    address: 'Somewhere in town',
    items: [{ productId: 'p9', variantId: 'v9', productTitle: 'Old thing', variantTitle: 'Default', unitPrice: 500, quantity: 1 }],
    subtotal: 500,
    deliveryCharges: 0,
    total: 500,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  const res = await lookup({ orderId: 'ORD-LEGACY01', phone: '03001234567' });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.status, 'dispatched');
  assert.equal(data.paymentMethod, 'cod');
  assert.equal(data.phone, '+923001234567');
  assert.equal(data.city, null);
});

test('an order with no stored phone can never be matched', async () => {
  orders.push({ store: STORE_ID, orderId: 'ORD-NOPHONE1', status: 'pending', items: [], total: 0 });
  assert.equal((await lookup({ orderId: 'ORD-NOPHONE1', phone: '03001234567' })).status, 404);
});

test('lookup validates its body: malformed phone and missing fields are 400', async () => {
  assert.equal((await lookup({ orderId: 'ORD-AAAAAAAA', phone: 'abc' })).status, 400);
  assert.equal((await lookup({ orderId: '', phone: '03001234567' })).status, 400);
  assert.equal((await lookup({ phone: '03001234567' })).status, 400);
  assert.equal((await lookup('{nope')).status, 400);
});

test('lookup is rate limited, so order ids cannot be walked', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.50' };
  let last: Response | null = null;
  for (let i = 0; i < 11; i += 1) last = await lookup({ orderId: 'ORD-AAAAAAA' + (i % 10), phone: '03001234567' }, headers);
  assert.equal(last!.status, 429);
  assert.equal((await last!.json()).error.code, 'RATE_LIMITED');
  assert.ok(last!.headers.get('retry-after'));
});

test('lookup follows the store rules: malformed id 404, inactive 403, outage 503', async () => {
  assert.equal((await lookup({ orderId: 'ORD-AAAAAAAA', phone: '03001234567' }, {}, 'nope')).status, 404);
  storeRow = { ...activeStore(), status: 'archived' };
  assert.equal((await lookup({ orderId: 'ORD-AAAAAAAA', phone: '03001234567' })).status, 403);
  storeRow = activeStore();
  simulateOutage();
  connectFails = true;
  assert.equal((await lookup({ orderId: 'ORD-AAAAAAAA', phone: '03001234567' })).status, 503);
});

/* ------------------------------------------ variants ------------------------------------------ */

const TOP = '65a0000000000000000000b5';
const TOP_S = '65a0000000000000000000e7';
const TOP_M = '65a0000000000000000000e8';
const TOP_FREE = '65a0000000000000000000e9';

function addSizedTop(deliveryCharge: number | null = null): void {
  const size = (id: string, title: string, price: number, stockQuantity: number, trackQuantity = true) => ({
    _id: id,
    title,
    sku: 'TOP-' + title,
    price,
    trackQuantity,
    stockQuantity,
    lowStockThreshold: null,
  });
  products.set(
    TOP,
    product(TOP, {
      title: 'Lawn top',
      deliveryCharge,
      variants: [size(TOP_S, 'S', 1000, 2), size(TOP_M, 'M', 1200, 5), size(TOP_FREE, 'Free', 900, 0, false)],
    }),
  );
}

const units = (id: string): number =>
  products.get(TOP)!.variants.find((candidate: { _id: string }) => candidate._id === id).stockQuantity;

test('a product with several variants needs a variantId: 422 VARIANT_REQUIRED, and nothing moves', async () => {
  addSizedTop();
  const res = await order({ lines: [{ productId: TOP, qty: 1 }] });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, 'VARIANT_REQUIRED');
  assert.equal(body.productId, TOP);
  assert.equal(orders.length, 0);
  assert.equal(units(TOP_S), 2);
});

test('a product with one variant may leave variantId out, and the server resolves the Default', async () => {
  const res = await order({ lines: [{ productId: SHIRT, qty: 1 }] });
  assert.equal(res.status, 201);
  assert.equal(orders[0].items[0].variantId, VARIANT_OF[SHIRT]);
  assert.equal(orders[0].items[0].variantTitle, 'Default');
});

test('naming the Default variant and leaving it out are one line, so stock is judged once', async () => {
  const res = await order({ lines: [{ productId: MUG, qty: 2 }, { productId: MUG, variantId: VARIANT_OF[MUG], qty: 2 }] });
  assert.equal(res.status, 409, '4 mugs asked for, 3 in stock');
  assert.equal(stock(MUG), 3);
});

test('the variant decides the price and the stock, and the order line snapshots it', async () => {
  addSizedTop();
  const res = await order({ lines: [{ productId: TOP, variantId: TOP_M, qty: 2 }] });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).data.subtotal, 2400);
  assert.equal(units(TOP_M), 3);
  assert.equal(units(TOP_S), 2, 'the other size is untouched');
  assert.deepEqual(orders[0].items, [
    { productId: TOP, variantId: TOP_M, productTitle: 'Lawn top', variantTitle: 'M', sku: 'TOP-M', unitPrice: 1200, quantity: 2 },
  ]);
});

test('two variants of one product are two lines', async () => {
  addSizedTop();
  const res = await order({ lines: [{ productId: TOP, variantId: TOP_S, qty: 1 }, { productId: TOP, variantId: TOP_M, qty: 1 }] });
  assert.equal(res.status, 201);
  assert.equal(orders[0].items.length, 2);
  assert.equal(orders[0].subtotal, 2200);
});

test('a variant of another product, or a malformed one, is 422 UNKNOWN_VARIANT', async () => {
  addSizedTop();
  for (const variantId of [VARIANT_OF[SHIRT], '65a0000000000000000000ff', 'nope']) {
    const res = await order({ lines: [{ productId: TOP, variantId, qty: 1 }] });
    assert.equal(res.status, 422, variantId);
    assert.equal((await res.json()).error.code, 'UNKNOWN_VARIANT');
  }
  assert.equal(orders.length, 0);
});

test('stock is judged per variant: S can run out while M is still for sale', async () => {
  addSizedTop();
  assert.equal((await order({ lines: [{ productId: TOP, variantId: TOP_S, qty: 3 }] })).status, 409);
  assert.equal((await order({ lines: [{ productId: TOP, variantId: TOP_M, qty: 3 }] })).status, 201);
});

test('a variant that does not track quantity sells without limit and is never decremented', async () => {
  addSizedTop();
  const res = await order({ lines: [{ productId: TOP, variantId: TOP_FREE, qty: 50 }] });
  assert.equal(res.status, 201);
  assert.equal(units(TOP_FREE), 0);
  assert.equal(movements.length, 0);
});

test('a product delivery override is charged once however many of its variants are ordered', async () => {
  addSizedTop(400);
  const res = await order({ lines: [{ productId: TOP, variantId: TOP_S, qty: 1 }, { productId: TOP, variantId: TOP_M, qty: 1 }] });
  const { data } = await res.json();
  assert.equal(data.deliveryCharges, 400, 'the override, once, not the store rate and not the sum');
  assert.equal(data.total, 2600);
});

test('order lookup carries the variant and never the sku', async () => {
  addSizedTop();
  const placed = await (await order({ lines: [{ productId: TOP, variantId: TOP_M, qty: 1 }] })).json();
  const res = await lookup({ orderId: placed.data.orderId, phone: CUSTOMER.phone });
  const raw = await res.text();
  assert.equal(raw.includes('TOP-M'), false);
  const { data } = storefrontOrderLookupResponseSchema.parse(JSON.parse(raw));
  assert.equal(data.items[0].variantId, TOP_M);
  assert.equal(data.items[0].variantTitle, 'M');
});
