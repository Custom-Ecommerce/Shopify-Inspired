import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Discount, Order, Product, StockMovement, Store } from '@/lib/services';
import { storefrontCartQuoteResponseSchema } from '@/lib/contracts';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { placeOrder } from '../src/lib/storefront/order-service';
import { DISCOUNT_CHECK_LIMIT, resetRateLimits } from '../src/lib/storefront/rate-limit';
import type { ParsedOrderRequest } from '../src/lib/storefront/order-request';

const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const PRODUCT = '65a0000000000000000000b1';
const VARIANT = '65a0000000000000000000e1';
const DISCOUNT = '65a0000000000000000000d1';

type Any = Record<string, any>;
const DiscountStub = Discount as unknown as Any;
const OrderStub = Order as unknown as Any;
const ProductStub = Product as unknown as Any;
const MovementStub = StockMovement as unknown as Any;
const StoreStub = Store as unknown as Any;

const chain = (value: unknown): Any => {
  const query: Any = { select: () => query, lean: async () => value };
  return query;
};

let discounts: Any[];
let orders: Any[];
let stock: number;
let reserveFails: boolean;
let saveFails: unknown;
let claims: number;
let restore: () => void;

const commerce = { id: STORE, deliveryRate: 250, freeDeliveryThreshold: 5000, codEnabled: true, cardEnabled: false };

const discount = (fields: Any = {}): Any => ({ _id: DISCOUNT, store: STORE, code: 'EID10', type: 'percentage', value: 10, usedCount: 0, maxUses: null, isActive: true, applicableProducts: [], archivedAt: null, ...fields });

let nextKey = 0;
const request = (code: string | null = 'EID10', fields: Partial<ParsedOrderRequest> = {}): ParsedOrderRequest => ({
  idempotencyKey: 'discount-key-' + (nextKey += 1),
  fingerprint: 'f' + nextKey,
  customer: { customerName: 'Sara', phone: '+923001234567', address: 'House 12, Street 4', city: 'Karachi', email: null, note: null },
  paymentMethod: 'cod',
  discountCode: code,
  lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 1 }],
  ...fields,
});

const usedCount = () => discounts[0]!.usedCount as number;

beforeEach(() => {
  discounts = [discount()];
  orders = [];
  stock = 10;
  reserveFails = false;
  saveFails = null;
  claims = 0;
  resetRateLimits();
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';

  const saved = {
    connect: (mongoose as Any).connect,
    dFindOne: DiscountStub.findOne,
    dUpdate: DiscountStub.updateOne,
    oFindOne: OrderStub.findOne,
    oCreate: OrderStub.create,
    pFind: ProductStub.find,
    pUpdate: ProductStub.findOneAndUpdate,
    pExists: ProductStub.exists,
    mCreate: MovementStub.create,
    sFind: StoreStub.findById,
  };
  (mongoose as Any).connect = async () => mongoose;
  DiscountStub.findOne = (filter: Any) => ({ lean: async () => {
    const row = discounts.find((d) => d.store === filter.store && d.code === filter.code);
    return row ? { ...row } : null;
  } });
  // One write, one step, as MongoDB does for one document.
  DiscountStub.updateOne = async (filter: Any, update: Any) => {
    const row = discounts.find((d) => d._id === filter._id && d.store === filter.store);
    if (!row) return { matchedCount: 0 };
    if (filter.usedCount && !(row.usedCount > filter.usedCount.$gt)) return { matchedCount: 0 };
    if (filter.$or) {
      claims += 1;
      if (row.isActive === false || row.archivedAt) return { matchedCount: 0 };
      if (row.maxUses !== null && row.usedCount >= row.maxUses) return { matchedCount: 0 };
    }
    row.usedCount += update.$inc.usedCount;
    return { matchedCount: 1 };
  };
  OrderStub.findOne = (filter: Any) => ({ lean: async () => orders.find((o) => o.idempotencyKey === filter.idempotencyKey) ?? null });
  OrderStub.create = async (doc: Any) => {
    if (saveFails) throw saveFails;
    orders.push(doc);
    return doc;
  };
  ProductStub.find = () =>
    chain([{ _id: PRODUCT, isPublished: true, title: 'Shirt', slug: 'shirt', deliveryCharge: null, variants: [{ _id: VARIANT, title: 'Default', price: 1000, trackQuantity: true, stockQuantity: stock }] }]);
  ProductStub.findOneAndUpdate = (_filter: Any, update: Any) => {
    if (reserveFails) return chain(null);
    stock += update.$inc['variants.$.stockQuantity'];
    return chain({ variants: [{ _id: VARIANT, stockQuantity: stock }] });
  };
  // A variant that tracks stock: the "untracked" check finds nothing, the "still live" check finds it.
  ProductStub.exists = async (filter: Any) => (filter.variants?.$elemMatch?.trackQuantity === false ? null : { _id: PRODUCT });
  MovementStub.create = async () => ({});
  StoreStub.findById = () => chain({ _id: STORE, status: 'active', storefront: { deliveryRate: 250, freeDeliveryThreshold: 5000 }, paymentSettings: { codEnabled: true } });
  restore = () => {
    (mongoose as Any).connect = saved.connect;
    DiscountStub.findOne = saved.dFindOne;
    DiscountStub.updateOne = saved.dUpdate;
    OrderStub.findOne = saved.oFindOne;
    OrderStub.create = saved.oCreate;
    ProductStub.find = saved.pFind;
    ProductStub.findOneAndUpdate = saved.pUpdate;
    ProductStub.exists = saved.pExists;
    MovementStub.create = saved.mCreate;
    StoreStub.findById = saved.sFind;
    delete process.env.TRUSTED_PROXY_HOPS;
  };
});

afterEach(() => restore());

const refusalOf = async (work: Promise<unknown>): Promise<StorefrontHttpError> => {
  const err = await work.then(() => null, (caught: unknown) => caught);
  assert.ok(err instanceof StorefrontHttpError, 'expected a refusal');
  return err;
};

/* ------------------------------------------- placement ------------------------------------------- */

test('an order with a code stores the code, the amount and a snapshot, and takes one use', async () => {
  const { order } = await placeOrder(STORE, commerce, request());
  const saved = orders[0]!;
  assert.equal(saved.discountCode, 'EID10');
  assert.equal(saved.discountAmount, 100);
  assert.deepEqual(saved.discountSnapshot, { discountId: DISCOUNT, type: 'percentage', value: 10, minOrderAmount: null });
  assert.equal(saved.subtotal, 1000);
  assert.equal(saved.deliveryCharges, 250);
  assert.equal(saved.total, 1150);
  assert.equal(usedCount(), 1);
  assert.equal(order.total, 1150);
});

test('an order without a code adds no discount fields and touches no discount', async () => {
  await placeOrder(STORE, commerce, request(null));
  assert.equal('discountCode' in orders[0]!, false);
  assert.equal(claims, 0);
  assert.equal(usedCount(), 0);
});

test('two parallel orders on the last use leave one winner; the loser gets a clear code and no order', async () => {
  discounts = [discount({ maxUses: 1 })];
  const results = await Promise.allSettled([placeOrder(STORE, commerce, request()), placeOrder(STORE, commerce, request())]);
  const won = results.filter((result) => result.status === 'fulfilled');
  const lost = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  const err = lost[0]!.reason as StorefrontHttpError;
  assert.equal(err.status, 409);
  assert.equal(err.code, 'DISCOUNT_USED_UP');
  assert.equal(err.message, 'This code has been fully used.');
  assert.equal(orders.length, 1);
  assert.equal(usedCount(), 1);
  assert.equal(stock, 9, 'the loser took no stock');
});

test('ten parallel orders on three uses leave exactly three orders', async () => {
  discounts = [discount({ maxUses: 3 })];
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => placeOrder(STORE, commerce, request())));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(orders.length, 3);
  assert.equal(usedCount(), 3);
});

test('a failure taking stock gives the use back', async () => {
  reserveFails = true;
  const err = await refusalOf(placeOrder(STORE, commerce, request()));
  assert.equal(err.code, 'OUT_OF_STOCK');
  assert.equal(claims, 1);
  assert.equal(usedCount(), 0);
  assert.equal(orders.length, 0);
});

test('a failure saving the order gives the use and the stock back', async () => {
  saveFails = new Error('save failed');
  await assert.rejects(placeOrder(STORE, commerce, request()), /save failed/);
  assert.equal(claims, 1);
  assert.equal(usedCount(), 0);
  assert.equal(stock, 10);
});

test('a parallel request with the same key costs one use, once', async () => {
  const req = request();
  saveFails = Object.assign(new Error('E11000 idempotencyKey'), { code: 11000, keyPattern: { idempotencyKey: 1 } });
  const winner = { orderId: 'ORD-WIN', idempotencyKey: req.idempotencyKey, requestFingerprint: req.fingerprint };
  let reads = 0;
  OrderStub.findOne = () => ({ lean: async () => ((reads += 1) === 1 ? null : winner) });
  discounts = [discount({ usedCount: 1 })]; // the winner's use
  const { order, replayed } = await placeOrder(STORE, commerce, req);
  assert.equal(replayed, true);
  assert.equal(order.orderId, 'ORD-WIN');
  assert.equal(usedCount(), 1);
});

test('a replayed order takes no second use', async () => {
  const req = request();
  await placeOrder(STORE, commerce, req);
  const { replayed } = await placeOrder(STORE, commerce, req);
  assert.equal(replayed, true);
  assert.equal(usedCount(), 1);
  assert.equal(orders.length, 1);
});

test("another store's code is refused as an unknown code, and is not touched", async () => {
  discounts = [discount({ store: OTHER_STORE })];
  const err = await refusalOf(placeOrder(STORE, commerce, request()));
  assert.equal(err.status, 422);
  assert.equal(err.code, 'DISCOUNT_REJECTED');
  assert.equal(err.extra.reason, 'unknown');
  assert.equal(err.message, 'This code is not valid.');
  assert.equal(claims, 0);
  assert.equal(usedCount(), 0);
  assert.equal(orders.length, 0);
});

test('an order with a code that cannot be used is refused, and no stock moves', async () => {
  for (const [fields, reason] of [
    [{ isActive: false }, 'inactive'],
    [{ endDate: new Date('2020-01-01') }, 'expired'],
    [{ startDate: new Date('2099-01-01') }, 'not_started'],
    [{ minOrderAmount: 5000 }, 'minimum_not_met'],
    [{ archivedAt: new Date() }, 'unknown'],
    [{ type: 'free_delivery' }, 'unknown'],
  ] as const) {
    discounts = [discount(fields)];
    const err = await refusalOf(placeOrder(STORE, commerce, request()));
    assert.equal(err.extra.reason, reason);
    assert.equal(err.extra.field, 'discountCode');
    assert.equal(stock, 10);
    assert.equal(orders.length, 0);
  }
});

test('a code archived between the price and the use is not spent, and no order exists', async () => {
  const reads: Any = DiscountStub.findOne;
  DiscountStub.findOne = (filter: Any) => ({ lean: async () => {
    const row = await reads(filter).lean();
    discounts[0]!.archivedAt = new Date();
    return row;
  } });
  const err = await refusalOf(placeOrder(STORE, commerce, request()));
  assert.equal(err.code, 'DISCOUNT_USED_UP');
  assert.equal(usedCount(), 0);
  assert.equal(orders.length, 0);
});

/* ------------------------------------------- the routes ------------------------------------------- */

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let quotePOST: Handler;
let orderPOST: Handler;

before(async () => {
  quotePOST = (await import('../src/app/api/storefront/v1/stores/[id]/cart/quote/route')).POST;
  orderPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/route')).POST;
});

function postTo(handler: Handler, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return handler(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + STORE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: STORE }) },
  );
}

const lines = [{ productId: PRODUCT, qty: 2 }];
const quote = (discountCode?: unknown, headers?: Record<string, string>) => postTo(quotePOST, '/cart/quote', { lines, ...(discountCode === undefined ? {} : { discountCode }) }, headers);
const quoted = async (discountCode?: unknown) => storefrontCartQuoteResponseSchema.parse(await (await quote(discountCode)).json()).data;

test('a quote with a code fills the discount and the new total, and takes no use', async () => {
  const data = await quoted('EID10');
  assert.equal(data.subtotal, 2000);
  assert.equal(data.discount, 200);
  assert.equal(data.deliveryCharges, 250);
  assert.equal(data.total, 2050);
  assert.equal(data.discountCode, 'EID10');
  assert.equal(data.discountError, null);
  assert.equal(usedCount(), 0);
});

test('the code is not case sensitive, and spaces around it do not matter', async () => {
  assert.equal((await quoted('  eid10 ')).discount, 200);
});

test('a code that cannot be used is a 200 priced without it, carrying the reason', async () => {
  const data = await quoted('NOPE');
  assert.equal(data.discount, 0);
  assert.equal(data.total, 2250);
  assert.equal(data.discountCode, null);
  assert.deepEqual(data.discountError, { reason: 'unknown', message: 'This code is not valid.' });
  assert.equal(data.canCheckout, true);
});

test('an unknown code and an archived code answer exactly the same', async () => {
  const unknown = await quoted('NOPE');
  discounts = [discount({ archivedAt: new Date() })];
  assert.deepEqual(await quoted('EID10'), unknown);
});

test('a blank code is no code', async () => {
  for (const code of ['', '   ', null]) {
    const data = await quoted(code);
    assert.equal(data.discountError, null);
    assert.equal(data.discount, 0);
  }
});

test('a code that is too long or not text is a 400 naming the field', async () => {
  for (const code of ['X'.repeat(41), 42, { $ne: '' }]) {
    const res = await quote(code);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { field: string }).field, 'discountCode');
  }
});

test('quotes that carry a code have the discount limit; quotes without one do not count against it', async () => {
  for (let i = 0; i < DISCOUNT_CHECK_LIMIT.limit; i += 1) assert.equal((await quote('GUESS' + i)).status, 200, String(i));
  const limited = await quote('GUESS');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal((await quote()).status, 200);
});

const orderBody = (discountCode?: string) => ({
  customer: { customerName: 'Sara Khan', phone: '0300 1234567', address: 'House 12, Street 4', city: 'Karachi' },
  lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 1 }],
  ...(discountCode === undefined ? {} : { discountCode }),
});
const placeThroughRoute = (discountCode?: string, key = 'route-key-' + (nextKey += 1)) => postTo(orderPOST, '/orders', orderBody(discountCode), { 'idempotency-key': key });

test('the order route charges the discounted total and reports the discount', async () => {
  const res = await placeThroughRoute('eid10');
  assert.equal(res.status, 201);
  const { data } = (await res.json()) as { data: Any };
  assert.equal(data.discount, 100);
  assert.equal(data.total, 1150);
  assert.equal(orders[0]!.discountCode, 'EID10');
});

test('the order route refuses a bad code with 422 and the reason; used up is 409', async () => {
  discounts = [discount({ endDate: new Date('2020-01-01') })];
  const expired = await placeThroughRoute('EID10');
  assert.equal(expired.status, 422);
  assert.deepEqual(await expired.json(), { error: { code: 'DISCOUNT_REJECTED', message: 'This code has expired.' }, reason: 'expired', field: 'discountCode' });

  discounts = [discount({ maxUses: 1, usedCount: 1 })];
  const usedUp = await placeThroughRoute('EID10');
  assert.equal(usedUp.status, 409);
  assert.equal(((await usedUp.json()) as Any).error.code, 'DISCOUNT_USED_UP');
  assert.equal(orders.length, 0);
});

test('the same key with a different code is a conflict, not a second order', async () => {
  assert.equal((await placeThroughRoute('EID10', 'route-key-fixed')).status, 201);
  assert.equal((await placeThroughRoute(undefined, 'route-key-fixed')).status, 409);
  assert.equal(orders.length, 1);
  assert.equal(usedCount(), 1);
});
