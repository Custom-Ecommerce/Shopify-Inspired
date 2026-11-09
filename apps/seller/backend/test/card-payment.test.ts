import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Discount, Order, Product, StockMovement, Store } from '@/lib/services';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';
import { stripeClient, type StripeClient } from '../src/lib/storefront/card-payment';
import { toStorefrontStoreDto } from '../src/lib/storefront/store-dto';

// D-082. Only Stripe's network calls are stubbed: the signature check is Stripe's own, over the bytes sent. No database.

const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const PRODUCT = '65a0000000000000000000b1';
const VARIANT = '65a0000000000000000000e1';
const DISCOUNT = '65a0000000000000000000d1';
const WEBHOOK_SECRET = 'whsec_stub_for_tests';
const SESSION = 'cs_test_1';
const PAY_URL = 'https://checkout.stripe.test/pay/cs_test_1';

type Any = Record<string, any>;
const OrderStub = Order as unknown as Any;
const ProductStub = Product as unknown as Any;
const DiscountStub = Discount as unknown as Any;
const MovementStub = StockMovement as unknown as Any;
const StoreStub = Store as unknown as Any;
const AuditStub = AuditLog as unknown as Any;

const chain = (value: unknown): Any => {
  const query: Any = { select: () => query, lean: async () => value };
  return query;
};

function matches(row: Any, filter: Any): boolean {
  return Object.entries(filter).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && '$exists' in value) return (row[key] !== undefined) === Boolean(value.$exists);
    if (value && typeof value === 'object' && '$ne' in value) return row[key] !== value.$ne;
    return String(row[key]) === String(value);
  });
}

let orders: Any[];
let stock: number;
let discount: Any;
let creates: Array<{ params: Any; options: Any }>;
let retrieves: string[];
let createBehaviour: () => Promise<Any>;
let warnings: unknown[][];
let errors: unknown[][];
let beforeCancelWrite: (() => void) | null;
let stripe: StripeClient;
let restore: () => void;

const setCardEnv = () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STOREFRONT_URL = 'https://markazify.test';
};

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let orderPOST: Handler;
let webhookPOST: (request: Request) => Promise<Response>;

before(async () => {
  setCardEnv();
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  stripe = await stripeClient();
  orderPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/route')).POST;
  webhookPOST = (await import('../src/app/api/webhooks/stripe-orders/route')).POST;
});

after(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_ORDER_WEBHOOK_SECRET;
  delete process.env.STOREFRONT_URL;
});

beforeEach(() => {
  setCardEnv();
  resetRateLimits();
  orders = [];
  stock = 5;
  discount = null;
  creates = [];
  retrieves = [];
  warnings = [];
  errors = [];
  beforeCancelWrite = null;
  createBehaviour = async () => ({ id: SESSION, url: PAY_URL });

  const sessions = stripe.checkout.sessions as unknown as Any;
  const saved = {
    connect: (mongoose as Any).connect,
    oFindOne: OrderStub.findOne,
    oCreate: OrderStub.create,
    oUpdate: OrderStub.updateOne,
    oFOAU: OrderStub.findOneAndUpdate,
    pFind: ProductStub.find,
    pFOAU: ProductStub.findOneAndUpdate,
    pExists: ProductStub.exists,
    dFindOne: DiscountStub.findOne,
    dUpdate: DiscountStub.updateOne,
    mCreate: MovementStub.create,
    sFind: StoreStub.findById,
    aCreate: AuditStub.create,
    create: sessions.create,
    retrieve: sessions.retrieve,
    warn: console.warn,
    error: console.error,
  };

  (mongoose as Any).connect = async () => mongoose;
  console.warn = (...args: unknown[]) => void warnings.push(args);
  console.error = (...args: unknown[]) => void errors.push(args);
  sessions.create = async (params: Any, options: Any) => {
    creates.push({ params, options });
    return createBehaviour();
  };
  sessions.retrieve = async (id: string) => {
    retrieves.push(id);
    return { id, url: PAY_URL };
  };
  OrderStub.findOne = (filter: Any) => ({ lean: async () => {
    const row = orders.find((o) => matches(o, filter));
    return row ? { ...row } : null;
  } });
  OrderStub.create = async (doc: Any) => {
    const row = { paymentStatus: 'unpaid', statusHistory: [], stripeSessionId: null, createdAt: new Date(), ...doc };
    orders.push(row);
    return { ...row };
  };
  OrderStub.updateOne = async (filter: Any, update: Any) => {
    const row = orders.find((o) => matches(o, filter));
    if (row) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0 };
  };
  OrderStub.findOneAndUpdate = (filter: Any, update: Any) => ({ lean: async () => {
    if (update.$set?.status === 'cancelled') beforeCancelWrite?.();
    const row = orders.find((o) => matches(o, filter));
    if (!row) return null;
    Object.assign(row, update.$set ?? {});
    for (const [key, value] of Object.entries(update.$push ?? {})) row[key] = [...(row[key] ?? []), value];
    return { ...row };
  } });
  ProductStub.find = () => chain([{ _id: PRODUCT, isPublished: true, title: 'Shirt', slug: 'shirt', deliveryCharge: null, variants: [{ _id: VARIANT, title: 'Default', price: 1000, trackQuantity: true, stockQuantity: stock }] }]);
  ProductStub.findOneAndUpdate = (_filter: Any, update: Any) => {
    stock += update.$inc['variants.$.stockQuantity'];
    return chain({ variants: [{ _id: VARIANT, stockQuantity: stock }] });
  };
  ProductStub.exists = async () => ({ _id: PRODUCT });
  MovementStub.create = async () => ({});
  AuditStub.create = async () => ({ _id: 'audit' });
  DiscountStub.findOne = () => ({ lean: async () => (discount ? { ...discount } : null) });
  DiscountStub.updateOne = async (_filter: Any, update: Any) => {
    discount.usedCount += update.$inc.usedCount;
    return { matchedCount: 1 };
  };
  StoreStub.findById = () => chain({ _id: STORE, slug: 'alpha-store', status: 'active', storefront: { deliveryRate: 250, freeDeliveryThreshold: 5000 }, paymentSettings: { codEnabled: true } });

  restore = () => {
    (mongoose as Any).connect = saved.connect;
    OrderStub.findOne = saved.oFindOne;
    OrderStub.create = saved.oCreate;
    OrderStub.updateOne = saved.oUpdate;
    OrderStub.findOneAndUpdate = saved.oFOAU;
    ProductStub.find = saved.pFind;
    ProductStub.findOneAndUpdate = saved.pFOAU;
    ProductStub.exists = saved.pExists;
    DiscountStub.findOne = saved.dFindOne;
    DiscountStub.updateOne = saved.dUpdate;
    MovementStub.create = saved.mCreate;
    StoreStub.findById = saved.sFind;
    AuditStub.create = saved.aCreate;
    sessions.create = saved.create;
    sessions.retrieve = saved.retrieve;
    console.warn = saved.warn;
    console.error = saved.error;
  };
});

afterEach(() => restore());

let nextKey = 0;
const CUSTOMER = { customerName: 'Sara Khan', phone: '0300 1234567', address: 'House 12, Street 4', city: 'Karachi' };
const place = (fields: Any = {}, key = 'card-key-' + (nextKey += 1)) =>
  orderPOST(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + STORE + '/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-forwarded-for': '203.0.113.1' },
      body: JSON.stringify({ customer: CUSTOMER, lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 1 }], paymentMethod: 'card', ...fields }),
    }),
    { params: Promise.resolve({ id: STORE }) },
  );

async function placed(): Promise<Any> {
  const res = await place();
  assert.equal(res.status, 201);
  return orders[0]!;
}

function webhook(type: string, session: Any, options: { secret?: string; id?: string; signature?: string | null; body?: string } = {}): Promise<Response> {
  const payload = JSON.stringify({ id: options.id ?? 'evt_1', object: 'event', type, data: { object: session } });
  const signature = options.signature === undefined ? stripe.webhooks.generateTestHeaderString({ payload, secret: options.secret ?? WEBHOOK_SECRET }) : options.signature;
  return webhookPOST(
    new Request('http://seller.test/api/webhooks/stripe-orders', {
      method: 'POST',
      headers: signature === null ? {} : { 'stripe-signature': signature },
      body: options.body ?? payload,
    }),
  );
}

const sessionFor = (order: Any, fields: Any = {}): Any => ({
  id: order.stripeSessionId,
  object: 'checkout.session',
  metadata: { orderId: String(order._id), storeId: STORE },
  amount_total: order.total * 100,
  currency: 'pkr',
  payment_status: 'paid',
  ...fields,
});

const COMPLETED = 'checkout.session.completed';
const EXPIRED = 'checkout.session.expired';
const unchanged = (order: Any) => {
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(order.paidAt, undefined);
  assert.deepEqual(order.statusHistory, []);
};

/* ------------------------------------------- placing ------------------------------------------- */

test('a card order is created like a COD order, then one session is made for its total', async () => {
  const res = await place();
  assert.equal(res.status, 201);
  const { data } = (await res.json()) as { data: Any };
  assert.equal(data.checkoutUrl, PAY_URL);

  const order = orders[0]!;
  assert.equal(order.paymentMethod, 'card');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(order.status, 'pending');
  assert.equal(order.stripeSessionId, SESSION);
  assert.equal(stock, 4, 'stock is taken as for COD');

  assert.equal(creates.length, 1);
  const { params, options } = creates[0]!;
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.metadata, { orderId: String(order._id), storeId: STORE });
  const item = params.line_items[0];
  assert.equal(params.line_items.length, 1);
  assert.equal(item.quantity, 1);
  assert.equal(item.price_data.currency, 'pkr');
  assert.equal(item.price_data.unit_amount, 125000, 'Rs. 1,000 + Rs. 250 delivery, x 100');
  assert.equal(item.price_data.product_data.name, 'Order ' + order.orderId);
  assert.equal(options.idempotencyKey, 'order-checkout-' + String(order._id));
});

test('the session expires 30 minutes out, the least Stripe accepts, and the expiry is saved on the order', async () => {
  const order = await placed();
  const seconds = creates[0]!.params.expires_at - Date.now() / 1000;
  assert.ok(seconds >= 30 * 60 && seconds <= 31 * 60, String(seconds));
  assert.equal(Math.floor(new Date(order.stripeSessionExpiresAt).getTime() / 1000), creates[0]!.params.expires_at);
});

test('the discount and delivery are already inside the amount', async () => {
  discount = { _id: DISCOUNT, store: STORE, code: 'EID10', type: 'percentage', value: 10, usedCount: 0, maxUses: null, isActive: true, applicableProducts: [] };
  await place({ discountCode: 'EID10' });
  assert.equal(creates[0]!.params.line_items[0].price_data.unit_amount, 115000, '1000 - 100 + 250');
  assert.equal(discount.usedCount, 1, 'the use is taken as for COD');
});

test('the return addresses come from configuration and the stored slug, never the browser', async () => {
  const order = orders[0] ?? null;
  assert.equal(order, null);
  await place({ success_url: 'https://evil.test/', cancel_url: 'https://evil.test/', successUrl: 'https://evil.test/', returnUrl: 'https://evil.test/' });
  const { params } = creates[0]!;
  const expected = 'https://alpha-store.markazify.test/orders/' + orders[0]!.orderId;
  assert.equal(params.success_url, expected);
  assert.equal(params.cancel_url, expected);
});

test('a replay of the same key returns the same order and the same session, and makes no second one', async () => {
  const first = await place({}, 'replay-key-1');
  const firstBody = (await first.json()) as { data: Any };
  const again = await place({}, 'replay-key-1');
  assert.equal(again.status, 200);
  const body = (await again.json()) as { data: Any };
  assert.equal(body.data.orderId, firstBody.data.orderId);
  assert.equal(body.data.checkoutUrl, PAY_URL);
  assert.equal(creates.length, 1);
  assert.deepEqual(retrieves, [SESSION]);
  assert.equal(orders.length, 1);
  assert.equal(stock, 4);
});

test('a replay after the session was never recorded asks Stripe with the identical request, so it cannot make a second', async () => {
  await place({}, 'replay-key-2');
  orders[0]!.stripeSessionId = null;
  assert.equal((await place({}, 'replay-key-2')).status, 200);
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[1]!.params, creates[0]!.params);
  assert.equal(creates[1]!.options.idempotencyKey, creates[0]!.options.idempotencyKey);
  assert.equal(retrieves.length, 0);
});

test('a replay of a paid order has nothing left to pay', async () => {
  await place({}, 'replay-key-3');
  orders[0]!.paymentStatus = 'paid';
  const res = await place({}, 'replay-key-3');
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { data: Any }).data.checkoutUrl, null);
  assert.equal(retrieves.length, 0);
});

test('a failure creating the session cancels the order, returns stock and the code use, and tells the shopper', async () => {
  discount = { _id: DISCOUNT, store: STORE, code: 'EID10', type: 'percentage', value: 10, usedCount: 0, maxUses: null, isActive: true, applicableProducts: [] };
  createBehaviour = async () => {
    throw Object.assign(new Error('secret detail'), { code: 'api_error' });
  };
  const res = await place({ discountCode: 'EID10' });
  assert.equal(res.status, 502);
  const body = (await res.json()) as Any;
  assert.equal(body.error.code, 'PAYMENT_NOT_STARTED');
  assert.match(body.error.message, /could not start the card payment/);
  assert.equal(body.data, undefined);

  const order = orders[0]!;
  assert.equal(order.status, 'cancelled');
  assert.equal(order.cancelReason, 'Payment not completed');
  assert.equal(stock, 5);
  assert.equal(discount.usedCount, 0);
  assert.equal(order.statusHistory[0].by, null, 'a system actor');
  assert.equal(JSON.stringify(errors).includes('secret detail'), false, 'only the error code is logged');
});

test('the same key after a failed start is refused, and Stripe is not asked again', async () => {
  createBehaviour = async () => {
    throw new Error('down');
  };
  await place({}, 'failed-key');
  const before = creates.length;
  const res = await place({}, 'failed-key');
  assert.equal(res.status, 502);
  assert.equal(creates.length, before);
});

test('a replay that fails soon after the order was made leaves it alone: the first request may still be working', async () => {
  await place({}, 'young-key');
  orders[0]!.stripeSessionId = null;
  createBehaviour = async () => {
    throw new Error('in progress');
  };
  const res = await place({}, 'young-key');
  assert.equal(res.status, 503);
  assert.equal(orders[0]!.status, 'pending');
  assert.equal(stock, 4);
});

test('a replay that fails long after the order was made cancels it, so it cannot hold stock forever', async () => {
  await place({}, 'old-key-1');
  orders[0]!.stripeSessionId = null;
  orders[0]!.createdAt = new Date(Date.now() - 10 * 60 * 1000);
  createBehaviour = async () => {
    throw new Error('expired');
  };
  assert.equal((await place({}, 'old-key-1')).status, 502);
  assert.equal(orders[0]!.status, 'cancelled');
  assert.equal(stock, 5);
});

test('cash on delivery never touches Stripe', async () => {
  const res = await place({ paymentMethod: 'cod' });
  assert.equal(res.status, 201);
  assert.equal(((await res.json()) as { data: Any }).data.checkoutUrl, null);
  assert.equal(creates.length, 0);
  assert.equal(orders[0]!.stripeSessionExpiresAt, undefined);
});

for (const missing of ['STRIPE_SECRET_KEY', 'STRIPE_ORDER_WEBHOOK_SECRET', 'STOREFRONT_URL']) {
  test('card is hidden and refused without ' + missing, async () => {
    delete process.env[missing];
    const store = await toStorefrontStoreDto({ _id: STORE, slug: 'alpha-store', name: 'Alpha' });
    assert.equal(store.commerce.cardEnabled, false);
    const res = await place();
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as Any).error.code, 'PAYMENT_METHOD_UNAVAILABLE');
    assert.equal(orders.length, 0);
    assert.equal(stock, 5);
    assert.equal(creates.length, 0);
  });
}

test('the store answer offers card when the keys are present', async () => {
  const store = await toStorefrontStoreDto({ _id: STORE, slug: 'alpha-store', name: 'Alpha' });
  assert.equal(store.commerce.cardEnabled, true);
});

test('a blank key counts as missing', async () => {
  process.env.STRIPE_SECRET_KEY = '   ';
  assert.equal((await toStorefrontStoreDto({ _id: STORE, slug: 'alpha-store', name: 'Alpha' })).commerce.cardEnabled, false);
});

/* ------------------------------------------- completed ------------------------------------------- */

test('payment completed marks the order paid, with a payment entry on its history', async () => {
  const order = await placed();
  const res = await webhook(COMPLETED, sessionFor(order));
  assert.equal(res.status, 200);
  assert.equal(order.paymentStatus, 'paid');
  assert.ok(order.paidAt instanceof Date);
  assert.equal(order.statusHistory.length, 1);
  assert.equal(order.statusHistory[0].kind, 'payment');
  assert.equal(order.statusHistory[0].by, null);
  assert.match(order.statusHistory[0].note, /^Card payment received: Rs\. 1,250/);
  assert.equal(order.status, 'pending', 'the order status itself does not move');
});

test('a repeated webhook changes nothing', async () => {
  const order = await placed();
  await webhook(COMPLETED, sessionFor(order), { id: 'evt_1' });
  const paidAt = order.paidAt;
  const res = await webhook(COMPLETED, sessionFor(order), { id: 'evt_1' });
  assert.equal(res.status, 200);
  assert.equal(order.statusHistory.length, 1);
  assert.equal(order.paidAt, paidAt);
  assert.equal(warnings.length, 1);
});

test('two webhooks at once mark it paid once', async () => {
  const order = await placed();
  const results = await Promise.all([webhook(COMPLETED, sessionFor(order), { id: 'evt_a' }), webhook(COMPLETED, sessionFor(order), { id: 'evt_b' })]);
  assert.deepEqual(results.map((res) => res.status), [200, 200]);
  assert.equal(order.statusHistory.length, 1);
});

for (const [name, fields, log] of [
  ['the wrong amount', { amount_total: 100 }, /amount/],
  ['the wrong currency', { currency: 'usd' }, /currency/],
  ['a session that is not paid', { payment_status: 'unpaid' }, /not paid/],
] as const) {
  test(name + ' is logged, answered 200, and changes nothing', async () => {
    const order = await placed();
    const res = await webhook(COMPLETED, sessionFor(order, fields));
    assert.equal(res.status, 200);
    unchanged(order);
    assert.match(String(warnings[0]?.[0]), log);
  });
}

test('the currency is compared without regard to case', async () => {
  const order = await placed();
  await webhook(COMPLETED, sessionFor(order, { currency: 'PKR' }));
  assert.equal(order.paymentStatus, 'paid');
});

for (const [name, change] of [
  ['an unknown session', (s: Any) => ({ ...s, id: 'cs_other' })],
  ['a session with no metadata', (s: Any) => ({ ...s, metadata: {} })],
  ['a session naming no real order', (s: Any) => ({ ...s, metadata: { orderId: 'nope', storeId: STORE } })],
  ["a session naming another store", (s: Any) => ({ ...s, metadata: { ...s.metadata, storeId: OTHER_STORE } })],
] as const) {
  test(name + ' is logged, answered 200, and changes nothing', async () => {
    const order = await placed();
    const res = await webhook(COMPLETED, change(sessionFor(order)));
    assert.equal(res.status, 200);
    unchanged(order);
    assert.equal(warnings.length, 1);
  });
}

test('a payment for an order already cancelled is flagged for a refund and changes nothing', async () => {
  const order = await placed();
  order.status = 'cancelled';
  const res = await webhook(COMPLETED, sessionFor(order));
  assert.equal(res.status, 200);
  assert.equal(order.paymentStatus, 'unpaid');
  assert.match(String(errors[0]?.[0]), /refund/);
});

test('no commission ledger is written', async () => {
  const order = await placed();
  let audits: Any[] = [];
  AuditStub.create = async (doc: Any) => {
    audits = [...audits, doc];
    return { _id: 'audit' };
  };
  await webhook(COMPLETED, sessionFor(order));
  assert.equal(audits.length, 1, 'one audit entry, and nothing else was written');
  assert.equal(order.paymentStatus, 'paid');
});

/* ------------------------------------------- signature ------------------------------------------- */

test('a bad signature is a 400 and changes nothing', async () => {
  const order = await placed();
  const res = await webhook(COMPLETED, sessionFor(order), { secret: 'whsec_wrong' });
  assert.equal(res.status, 400);
  unchanged(order);
});

test('no signature is a 400', async () => {
  const order = await placed();
  assert.equal((await webhook(COMPLETED, sessionFor(order), { signature: null })).status, 400);
  unchanged(order);
});

test('a body changed after signing is a 400: the signature covers the raw bytes', async () => {
  const order = await placed();
  const session = sessionFor(order);
  const tampered = JSON.stringify({ id: 'evt_1', object: 'event', type: COMPLETED, data: { object: { ...session, amount_total: 1 } } });
  const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: COMPLETED, data: { object: session } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  assert.equal((await webhook(COMPLETED, session, { signature, body: tampered })).status, 400);
  unchanged(order);
});

test('without its keys the webhook answers 503 and changes nothing', async () => {
  const order = await placed();
  delete process.env.STRIPE_ORDER_WEBHOOK_SECRET;
  assert.equal((await webhook(COMPLETED, sessionFor(order))).status, 503);
  unchanged(order);
});

test('a database failure answers 500, so Stripe sends it again', async () => {
  const order = await placed();
  OrderStub.findOne = () => ({ lean: async () => {
    throw new Error('db down');
  } });
  assert.equal((await webhook(COMPLETED, sessionFor(order))).status, 500);
});

test('other event types are acknowledged and ignored', async () => {
  const order = await placed();
  assert.equal((await webhook('customer.created', { id: 'cus_1' })).status, 200);
  unchanged(order);
});

/* ------------------------------------------- expired and failed ------------------------------------------- */

test('an expired session cancels the unpaid order, and stock and the code use come back once', async () => {
  discount = { _id: DISCOUNT, store: STORE, code: 'EID10', type: 'percentage', value: 10, usedCount: 0, maxUses: null, isActive: true, applicableProducts: [] };
  await place({ discountCode: 'EID10' });
  const order = orders[0]!;
  assert.equal(stock, 4);
  assert.equal(discount.usedCount, 1);

  assert.equal((await webhook(EXPIRED, sessionFor(order, { payment_status: 'unpaid' }))).status, 200);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.cancelReason, 'Payment not completed');
  assert.ok(order.stockRestoredAt instanceof Date);
  assert.ok(order.discountRestoredAt instanceof Date);
  assert.equal(stock, 5);
  assert.equal(discount.usedCount, 0);
  assert.equal(order.statusHistory.length, 1);
  assert.equal(order.statusHistory[0].by, null);

  assert.equal((await webhook(EXPIRED, sessionFor(order, { payment_status: 'unpaid' }), { id: 'evt_2' })).status, 200);
  assert.equal(stock, 5, 'a repeated event gives nothing back twice');
  assert.equal(discount.usedCount, 0);
  assert.equal(order.statusHistory.length, 1);
});

test('two expiry events at once cancel once', async () => {
  const order = await placed();
  await Promise.all([webhook(EXPIRED, sessionFor(order), { id: 'evt_a' }), webhook(EXPIRED, sessionFor(order), { id: 'evt_b' })]);
  assert.equal(stock, 5);
  assert.equal(order.statusHistory.length, 1);
});

test('a failed payment cancels the unpaid order', async () => {
  const order = await placed();
  await webhook('checkout.session.async_payment_failed', sessionFor(order, { payment_status: 'unpaid' }));
  assert.equal(order.status, 'cancelled');
  assert.equal(stock, 5);
});

test('a declined card does not cancel: the shopper can still try another in the same session', async () => {
  const order = await placed();
  assert.equal((await webhook('payment_intent.payment_failed', { id: 'pi_1', object: 'payment_intent', metadata: {} })).status, 200);
  assert.equal(order.status, 'pending');
  assert.equal(stock, 4);
});

test('a paid order is not cancelled by an expiry event', async () => {
  const order = await placed();
  await webhook(COMPLETED, sessionFor(order));
  assert.equal((await webhook(EXPIRED, sessionFor(order), { id: 'evt_2' })).status, 200);
  assert.equal(order.status, 'pending');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(stock, 4);
});

test('a payment landing between the read and the cancel write still wins', async () => {
  const order = await placed();
  beforeCancelWrite = () => {
    order.paymentStatus = 'paid';
  };
  assert.equal((await webhook(EXPIRED, sessionFor(order))).status, 200);
  assert.equal(order.status, 'pending');
  assert.equal(stock, 4);
});

test('an expiry for an unknown session changes nothing', async () => {
  const order = await placed();
  await webhook(EXPIRED, sessionFor(order, { id: 'cs_other' }));
  assert.equal(order.status, 'pending');
  assert.equal(stock, 4);
});

test('an expiry for an order already past cancelling changes nothing', async () => {
  const order = await placed();
  order.status = 'delivered';
  assert.equal((await webhook(EXPIRED, sessionFor(order))).status, 200);
  assert.equal(order.status, 'delivered');
  assert.equal(stock, 4);
});
