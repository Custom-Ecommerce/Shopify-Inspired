import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Order, Store } from '@/lib/services';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';
import { issueOrderAccessToken, isValidOrderAccessToken } from '../src/lib/storefront/order-access';

const SECRET = 's'.repeat(40);
const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const NUMBER = 'ORD-ABCD2345';
const NOW = Date.parse('2026-11-10T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

type Any = Record<string, any>;
const OrderStub = Order as unknown as Any;
const StoreStub = Store as unknown as Any;

const orderRow = (fields: Any = {}): Any => ({
  store: STORE,
  orderId: NUMBER,
  status: 'pending',
  paymentMethod: 'card',
  paymentStatus: 'paid',
  customerName: 'Sara Khan',
  phone: '+923001234567',
  address: 'House 12, Street 4',
  city: 'Karachi',
  subtotal: 1000,
  deliveryCharges: 250,
  discountAmount: 100,
  discountCode: 'EID10',
  total: 1150,
  items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1000, quantity: 1 }],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...fields,
});

let orders: Any[];
let reads: number;
let restore: () => void;

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let confirmationPOST: Handler;
let lookupPOST: Handler;
let trackPOST: Handler;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  confirmationPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/confirmation/route')).POST;
  lookupPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/lookup/route')).POST;
  trackPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/track/route')).POST;
});

beforeEach(() => {
  process.env.ORDER_ACCESS_SECRET = SECRET;
  process.env.TRUSTED_PROXY_HOPS = '1';
  resetRateLimits();
  orders = [orderRow()];
  reads = 0;
  const saved = { connect: (mongoose as Any).connect, findOne: OrderStub.findOne, findById: StoreStub.findById };
  (mongoose as Any).connect = async () => mongoose;
  OrderStub.findOne = (filter: Any) => ({ lean: async () => {
    reads += 1;
    return orders.find((o) => o.store === filter.store && o.orderId === filter.orderId) ?? null;
  } });
  StoreStub.findById = () => ({ select: () => ({ lean: async () => ({ _id: STORE, status: 'active', storefront: {}, paymentSettings: {} }) }) });
  restore = () => {
    (mongoose as Any).connect = saved.connect;
    OrderStub.findOne = saved.findOne;
    StoreStub.findById = saved.findById;
    delete process.env.ORDER_ACCESS_SECRET;
    delete process.env.TRUSTED_PROXY_HOPS;
  };
});

afterEach(() => restore());

const send = (handler: Handler, path: string, body: unknown, ip = '203.0.113.1') =>
  handler(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + STORE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: STORE }) },
  );

const confirm = (orderNumber: string, token: string, ip?: string) => send(confirmationPOST, '/orders/confirmation', { orderNumber, token }, ip);
const liveToken = (orderNumber = NUMBER, storeId = STORE) => issueOrderAccessToken(orderNumber, storeId, new Date()) as string;

/* ------------------------------------------- the token ------------------------------------------- */

test('a token is good for its order and store until it expires', () => {
  const token = issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW) as string;
  assert.equal(isValidOrderAccessToken(token, NUMBER, STORE, NOW), true);
  assert.equal(isValidOrderAccessToken(token, NUMBER, STORE, NOW + DAY - 1), true);
});

test('an expired token is refused, at the very moment it expires', () => {
  const token = issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW) as string;
  assert.equal(isValidOrderAccessToken(token, NUMBER, STORE, NOW + DAY), false);
});

test('its life counts from the order, so a replay of the placement cannot extend it', () => {
  const later = issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW + DAY) as string;
  assert.equal(isValidOrderAccessToken(later, NUMBER, STORE, NOW + DAY), false);
});

test('a token signed with another secret is refused', () => {
  process.env.ORDER_ACCESS_SECRET = 'x'.repeat(40);
  const forged = issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW) as string;
  process.env.ORDER_ACCESS_SECRET = SECRET;
  assert.equal(isValidOrderAccessToken(forged, NUMBER, STORE, NOW), false);
});

test('a token is refused for another order or another store', () => {
  const token = issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW) as string;
  assert.equal(isValidOrderAccessToken(token, 'ORD-OTHER999', STORE, NOW), false);
  assert.equal(isValidOrderAccessToken(token, NUMBER, OTHER_STORE, NOW), false);
});

test('moving the expiry out invalidates the signature', () => {
  const token = issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW) as string;
  const stretched = String(NOW + 365 * DAY) + token.slice(token.indexOf('.'));
  assert.equal(isValidOrderAccessToken(stretched, NUMBER, STORE, NOW), false);
});

test('anything that is not a token is refused without throwing', () => {
  for (const bad of ['', 'nonsense', '123.abc', '.', NOW + '.', '9'.repeat(40) + '.' + '0'.repeat(64)]) {
    assert.equal(isValidOrderAccessToken(bad, NUMBER, STORE, NOW), false, bad);
  }
});

test('with no usable secret none is issued and none is believed', () => {
  const token = issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW) as string;
  for (const secret of [undefined, '', 'short']) {
    if (secret === undefined) delete process.env.ORDER_ACCESS_SECRET;
    else process.env.ORDER_ACCESS_SECRET = secret;
    assert.equal(issueOrderAccessToken(NUMBER, STORE, new Date(NOW), NOW), null);
    assert.equal(isValidOrderAccessToken(token, NUMBER, STORE, NOW), false);
  }
});

/* ------------------------------------------- the route ------------------------------------------- */

test('a good token returns the same answer the lookup returns', async () => {
  const confirmed = await confirm(NUMBER, liveToken());
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.headers.get('cache-control'), 'no-store');
  const looked = await send(lookupPOST, '/orders/lookup', { orderId: NUMBER, phone: '0300 1234567' });
  const norm = (body: Any) => JSON.stringify(body);
  assert.equal(norm(await confirmed.json()), norm(await looked.json()));
});

test('the answer has what the confirmation page shows', async () => {
  const { data } = (await (await confirm(NUMBER, liveToken())).json()) as { data: Any };
  assert.equal(data.orderId, NUMBER);
  assert.equal(data.subtotal, 1000);
  assert.equal(data.discount, 100);
  assert.equal(data.deliveryCharges, 250);
  assert.equal(data.total, 1150);
  assert.equal(data.paymentMethod, 'card');
  assert.equal(data.paymentStatus, 'paid');
  assert.equal(data.address, 'House 12, Street 4');
  assert.equal(data.items.length, 1);
});

test('the order number may be typed in any case', async () => {
  assert.equal((await confirm(NUMBER.toLowerCase(), liveToken())).status, 200);
});

test('a forged token, an expired token and an unknown order give the same answer', async () => {
  const answers: Array<{ status: number; text: string }> = [];
  const forged = '9999999999999.' + '0'.repeat(64);
  const expired = issueOrderAccessToken(NUMBER, STORE, new Date(Date.now() - 2 * DAY)) as string;
  for (const [orderNumber, token] of [[NUMBER, forged], [NUMBER, expired], ['ORD-NOPE0000', liveToken('ORD-NOPE0000')], [NUMBER, 'garbage']] as const) {
    const res = await confirm(orderNumber, token);
    answers.push({ status: res.status, text: await res.text() });
  }
  assert.ok(answers.every((answer) => answer.status === 404));
  assert.equal(new Set(answers.map((answer) => answer.text)).size, 1);
});

test('a bad token never reaches the database', async () => {
  await confirm(NUMBER, 'garbage');
  assert.equal(reads, 0);
});

test("another store's token does not open this store's order", async () => {
  assert.equal((await confirm(NUMBER, liveToken(NUMBER, OTHER_STORE))).status, 404);
});

test("this store's token does not find another store's order of the same number", async () => {
  orders = [orderRow({ store: OTHER_STORE })];
  assert.equal((await confirm(NUMBER, liveToken())).status, 404);
});

test('a malformed body is a 400 naming the field', async () => {
  const res = await send(confirmationPOST, '/orders/confirmation', { orderNumber: NUMBER });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as Any).field, 'token');
});

test('it shares the lookup and tracking count: 10 between them', async () => {
  const token = liveToken();
  const ip = '203.0.113.50';
  for (let i = 0; i < 4; i += 1) assert.notEqual((await confirm(NUMBER, token, ip)).status, 429, 'confirm ' + i);
  for (let i = 0; i < 3; i += 1) assert.notEqual((await send(lookupPOST, '/orders/lookup', { orderId: NUMBER, phone: '03001234567' }, ip)).status, 429, 'lookup ' + i);
  for (let i = 0; i < 3; i += 1) assert.notEqual((await send(trackPOST, '/orders/track', { orderId: NUMBER, phone: '03001234567' }, ip)).status, 429, 'track ' + i);
  const limited = await confirm(NUMBER, token, ip);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});

test('with no secret configured the endpoint gives the same generic answer', async () => {
  const token = liveToken();
  delete process.env.ORDER_ACCESS_SECRET;
  assert.equal((await confirm(NUMBER, token)).status, 404);
});
