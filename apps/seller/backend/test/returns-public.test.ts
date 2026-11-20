import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';
import { deliveredAtOf } from '@/lib/returns';
import { sendReturnRequested } from '@/lib/notifications';
import { installReturnsWorld, settle, ORDER_A, ORDER_B, P1, P2, PHONE, STORE_A, STORE_B, V1, V2, type ReturnsWorld, type Row } from './helpers/returns-world';

// Sprint 5 EP-13.US01.T03 (D-107, D-108): the PUBLIC return routes under /api/storefront/v1/stores/:id/orders/:number/. The credential is the order
// number plus the phone (not the 24 hour order-access token); a wrong phone, an unknown order and another store's order give the same 404. Only a
// delivered COD order inside the window, up to the quantities not yet asked for. Models are in memory (./helpers/returns-world).

type Ctx = { params: Promise<{ id: string; number: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let world: ReturnsWorld;
let eligibilityGET: Handler;
let createPOST: Handler;
const DAY = 86_400_000;
let ipSeq = 0;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';
  eligibilityGET = (await import('../src/app/api/storefront/v1/stores/[id]/orders/[number]/return-eligibility/route')).GET as Handler;
  createPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/[number]/returns/route')).POST as Handler;
});

beforeEach(() => {
  resetRateLimits();
  ipSeq = 0;
  world = installReturnsWorld();
});

afterEach(() => world.restore());

const nextIp = (): string => '203.0.113.' + String((ipSeq += 1) % 250);

function eligibility(number = 'ORD-ABCD2345', phone: string | null = PHONE, store = STORE_A, headers: Row = {}) {
  const query = phone === null ? '' : '?phone=' + encodeURIComponent(phone);
  return eligibilityGET(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + store + '/orders/' + number + '/return-eligibility' + query, { headers: { 'x-forwarded-for': nextIp(), ...headers } }),
    { params: Promise.resolve({ id: store, number }) },
  );
}

function request(body: Row = {}, number = 'ORD-ABCD2345', store = STORE_A, headers: Row = {}) {
  return createPOST(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + store + '/orders/' + number + '/returns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...headers },
      body: JSON.stringify({ phone: PHONE, items: [{ productId: P1, variantId: V1, quantity: 1 }], reasonCode: 'damaged', ...body }),
    }),
    { params: Promise.resolve({ id: store, number }) },
  );
}

const json = async (res: Response) => (await res.json()) as any;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const deliveredOn = (when: Date) => [{ from: 'dispatched', to: 'delivered', by: null, at: when, note: null }];
const setWindow = (days: number) => {
  world.stores[0]!.storefront = { returnWindowDays: days };
};

// ---------------------------------------------------------------------------------------------------------- the delivered date

test('deliveredAtOf is the last statusHistory entry that moved the order to delivered, in ONE helper (no Order field)', () => {
  const early = new Date('2026-11-01T10:00:00Z');
  const late = new Date('2026-11-05T10:00:00Z');
  assert.equal(deliveredAtOf({ statusHistory: [{ to: 'dispatched', at: early }, { to: 'delivered', at: early }, { to: 'delivered', at: late }] })?.toISOString(), late.toISOString());
  assert.equal(deliveredAtOf({ statusHistory: [{ to: 'dispatched', at: early }] }), null, 'never delivered');
  assert.equal(deliveredAtOf({ statusHistory: [] }), null);
  assert.equal(deliveredAtOf({}), null);
  assert.equal(deliveredAtOf({ statusHistory: [{ to: 'delivered', at: 'not a date' }] }), null);
  assert.equal(deliveredAtOf({ statusHistory: [{ to: 'delivered', at: '2026-11-05T10:00:00Z' }] })?.toISOString(), late.toISOString(), 'a stored string date reads too');
});

// ---------------------------------------------------------------------------------------------------------------- eligibility

test('eligibility: a delivered COD order inside the window answers the returnable lines and the window, and nothing about the customer', async () => {
  world.order();
  const res = await eligibility();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { data } = await json(res);
  assert.equal(data.eligible, true);
  assert.equal(data.reason, null);
  assert.equal(data.windowDays, 7, 'the default window');
  assert.deepEqual(data.lines.map((l: Row) => [l.productId, l.variantId, l.deliveredQuantity, l.returnableQuantity, l.unitPrice]), [
    [P1, V1, 2, 2, 1000],
    [P2, V2, 1, 1, 500],
  ]);
  assert.ok(Date.parse(data.windowEndsAt) > Date.now(), 'the window ends in the future');
  assert.ok(Date.parse(data.deliveredAt) < Date.now());
  const text = JSON.stringify(data);
  for (const secret of ['Sara Khan', PHONE, '0300', 'sara@example.pk', 'House', 'ORD-ABCD2345']) assert.equal(text.includes(secret), false, secret);
});

test('eligibility: the phone is the credential in any spelling; a wrong phone, an unknown order and another store\'s order are the SAME 404', async () => {
  world.order();
  world.order({ _id: ORDER_B, store: STORE_B, orderId: 'ORD-BBBB2222' });
  for (const phone of ['0300 1234567', '03001234567', '+92 300 1234567', '923001234567']) assert.equal((await eligibility('ORD-ABCD2345', phone)).status, 200, phone);
  assert.equal((await eligibility('ord-abcd2345')).status, 200, 'the order number is read in any letter case');
  const wrongPhone = await eligibility('ORD-ABCD2345', '03009999999');
  const unknown = await eligibility('ORD-ZZZZ9999');
  const foreign = await eligibility('ORD-BBBB2222');
  assert.deepEqual([wrongPhone.status, unknown.status, foreign.status], [404, 404, 404]);
  const bodies = [await json(wrongPhone), await json(unknown), await json(foreign)];
  assert.deepEqual(bodies[1], bodies[0]);
  assert.deepEqual(bodies[2], bodies[0]);
  assert.equal(bodies[0].error.code, 'ORDER_NOT_FOUND');
});

test('eligibility: no phone, or a phone that is not a mobile number, is 400 naming the field (never a 404 that reveals anything)', async () => {
  world.order();
  for (const phone of [null, '', 'abc', '12345']) {
    const res = await eligibility('ORD-ABCD2345', phone);
    assert.equal(res.status, 400, String(phone));
    assert.equal((await json(res)).field, 'phone');
  }
});

test('eligibility: the window counts from the delivered date: open at 6 days, closed at 8, longer when the store allows', async () => {
  world.order({ statusHistory: deliveredOn(daysAgo(6)) });
  assert.equal((await json(await eligibility())).data.eligible, true);
  world.orders.length = 0;
  world.order({ statusHistory: deliveredOn(daysAgo(8)) });
  let data = (await json(await eligibility())).data;
  assert.equal(data.eligible, false);
  assert.equal(data.reason, 'window_closed');
  assert.deepEqual(data.lines, [], 'nothing is offered once the window has closed');
  setWindow(30);
  data = (await json(await eligibility())).data;
  assert.equal(data.eligible, true);
  assert.equal(data.windowDays, 30);
});

test('eligibility: 0 days means the store takes no returns; a never delivered order and a card order are not returnable', async () => {
  world.order();
  setWindow(0);
  assert.equal((await json(await eligibility())).data.reason, 'returns_off');
  setWindow(7);
  world.orders.length = 0;
  world.order({ status: 'dispatched', statusHistory: [] });
  assert.equal((await json(await eligibility())).data.reason, 'not_delivered');
  world.orders.length = 0;
  world.order({ status: 'processing', statusHistory: deliveredOn(daysAgo(1)) });
  assert.equal((await json(await eligibility())).data.reason, 'not_delivered', 'the status has to be delivered now, not only once');
  world.orders.length = 0;
  world.order({ paymentMethod: 'card', paymentStatus: 'paid' });
  assert.equal((await json(await eligibility())).data.reason, 'card_order');
});

test('eligibility: what earlier returns ask for is taken off, and a rejected return does not count', async () => {
  world.order();
  world.ret({ status: 'requested', items: [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 1, unitPrice: 1000 }] });
  world.ret({ status: 'rejected', items: [{ productId: P2, variantId: V2, productTitle: 'Cap', variantTitle: 'Default', quantity: 1, unitPrice: 500 }] });
  const { data } = await json(await eligibility());
  assert.deepEqual(data.lines.map((l: Row) => [l.variantId, l.returnableQuantity]), [[V1, 1], [V2, 1]]);
  world.ret({ status: 'approved', items: [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 1, unitPrice: 1000 }, { productId: P2, variantId: V2, productTitle: 'Cap', variantTitle: 'Default', quantity: 1, unitPrice: 500 }] });
  const none = (await json(await eligibility())).data;
  assert.equal(none.eligible, false);
  assert.equal(none.reason, 'nothing_left');
});

// ------------------------------------------------------------------------------------------------------------------- request

test('a request saves ONE return priced from the order (never from the client), and changes nothing on the order or the stock', async () => {
  world.order();
  const res = await request({ note: '  It arrived\n broken ', items: [{ productId: P1, variantId: V1, quantity: 2, unitPrice: 1, price: 1 }] });
  // The extra price fields are refused (strict), so nothing from the client can set a price.
  assert.equal(res.status, 400);
  const ok = await request({ note: '  It arrived\n broken ', items: [{ productId: P1, variantId: V1, quantity: 2 }], phone: '0300 1234567' });
  assert.equal(ok.status, 201);
  const { data } = await json(ok);
  assert.match(data.returnNumber, /^RET-[A-Z0-9]{8}$/);
  assert.equal(data.status, 'requested');
  assert.equal(world.returns.length, 1);
  const saved = world.returns[0]!;
  assert.equal(saved.status, 'requested');
  assert.equal(saved.returnNumber, data.returnNumber);
  assert.equal(saved.orderNumber, 'ORD-ABCD2345');
  assert.equal(String(saved.order), ORDER_A);
  assert.equal(String(saved.store), STORE_A);
  assert.equal(saved.contactPhone, PHONE, 'stored as the normalized phone whatever way it was typed');
  assert.equal(saved.reason, 'damaged');
  assert.equal(saved.reasonCode, 'damaged');
  assert.equal(saved.description, 'It arrived broken');
  assert.deepEqual(saved.items, [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 2, unitPrice: 1000 }]);
  assert.equal(world.orderWrites, 0, 'the order is not touched');
  assert.deepEqual(world.stock, { [V1]: 5, [V2]: 5 }, 'no stock moves until the seller receives the goods');
});

test('a request names the same line twice: the quantities add up and the caps still apply', async () => {
  world.order();
  const ok = await request({ items: [{ productId: P1, variantId: V1, quantity: 1 }, { productId: P1, variantId: V1, quantity: 1 }] });
  assert.equal(ok.status, 201);
  assert.deepEqual(world.returns[0]!.items.map((i: Row) => i.quantity), [2]);
  world.returns.length = 0;
  const over = await request({ items: [{ productId: P1, variantId: V1, quantity: 2 }, { productId: P1, variantId: V1, quantity: 1 }] });
  assert.equal(over.status, 422);
  assert.equal(world.returns.length, 0);
});

test('the quantity cap: delivered minus already asked for; several partial returns are allowed; a rejected one gives its quantity back', async () => {
  world.order();
  assert.equal((await request({ items: [{ productId: P1, variantId: V1, quantity: 3 }] })).status, 422, 'more than was delivered');
  assert.equal(world.returns.length, 0, 'nothing is saved');
  assert.equal((await request({ items: [{ productId: P1, variantId: V1, quantity: 1 }] })).status, 201);
  assert.equal((await request({ items: [{ productId: P1, variantId: V1, quantity: 1 }] })).status, 201, 'a second partial return of the same order');
  const third = await request({ items: [{ productId: P1, variantId: V1, quantity: 1 }] });
  assert.equal(third.status, 422);
  const body = await json(third);
  assert.equal(body.error.code, 'RETURN_NOT_ELIGIBLE');
  assert.equal(body.field, 'items');
  assert.equal(world.returns.length, 2);
  world.returns[0]!.status = 'rejected';
  assert.equal((await request({ items: [{ productId: P1, variantId: V1, quantity: 1 }] })).status, 201, 'the rejected return no longer counts');
  assert.equal(world.returns.length, 3);
});

test('a line that is not part of the order, another variant of a product, is refused', async () => {
  world.order();
  assert.equal((await request({ items: [{ productId: P1, variantId: V2, quantity: 1 }] })).status, 422);
  assert.equal((await request({ items: [{ productId: '65a0000000000000000c0099', variantId: V1, quantity: 1 }] })).status, 422);
  assert.equal(world.returns.length, 0);
});

test('a request is refused with 422 RETURN_NOT_ELIGIBLE and the reason: not delivered, window closed, no returns, a card order', async () => {
  const cases: Array<[string, Row, () => void]> = [
    ['not_delivered', { status: 'dispatched', statusHistory: [] }, () => undefined],
    ['window_closed', { statusHistory: deliveredOn(daysAgo(9)) }, () => undefined],
    ['returns_off', {}, () => setWindow(0)],
    ['card_order', { paymentMethod: 'card', paymentStatus: 'paid' }, () => setWindow(7)],
  ];
  for (const [reason, fields, prepare] of cases) {
    world.orders.length = 0;
    world.returns.length = 0;
    setWindow(7);
    world.order(fields);
    prepare();
    const res = await request();
    assert.equal(res.status, 422, reason);
    const body = await json(res);
    assert.equal(body.error.code, 'RETURN_NOT_ELIGIBLE');
    assert.equal(body.reason, reason);
    assert.ok(body.error.message.length > 0);
    assert.equal(world.returns.length, 0, reason);
  }
});

test('a wrong phone, an unknown order and another store\'s order are the same 404 on a request too, and save nothing', async () => {
  world.order();
  world.order({ _id: ORDER_B, store: STORE_B, orderId: 'ORD-BBBB2222' });
  const results = [await request({ phone: '03009999999' }), await request({}, 'ORD-ZZZZ9999'), await request({}, 'ORD-BBBB2222')];
  assert.deepEqual(results.map((r) => r.status), [404, 404, 404]);
  const bodies = await Promise.all(results.map(json));
  assert.deepEqual(bodies[1], bodies[0]);
  assert.deepEqual(bodies[2], bodies[0]);
  assert.equal(world.returns.length, 0);
});

test('a bad body is 400 naming the field; nothing is saved', async () => {
  world.order();
  const cases: Array<[Row, string]> = [
    [{ reasonCode: 'broken' }, 'reasonCode'],
    [{ items: [] }, 'items'],
    [{ items: [{ productId: P1, variantId: V1, quantity: 0 }] }, 'items.0.quantity'],
    [{ items: [{ productId: P1, quantity: 1 }] }, 'items.0.variantId'],
    [{ note: 'x'.repeat(301) }, 'note'],
    [{ note: '<b>' }, 'note'],
    [{ phone: 'abc' }, 'phone'],
    [{ status: 'approved' }, ''],
  ];
  for (const [body, field] of cases) {
    const res = await request(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const answer = await json(res);
    assert.equal(answer.error.code, 'INVALID_REQUEST');
    if (field !== '') assert.equal(answer.field, field, JSON.stringify(body));
  }
  assert.equal(world.returns.length, 0);
});

test('a store that is not active, or a malformed store id, does not take a return', async () => {
  world.order();
  world.stores[0]!.status = 'suspended';
  assert.equal((await request()).status, 403);
  assert.equal((await eligibility()).status, 403);
  world.stores[0]!.status = 'active';
  assert.equal((await request({}, 'ORD-ABCD2345', 'not-an-id')).status, 404);
});

// ---------------------------------------------------------------------------------------------------------------- the race

test('two requests racing for the last unit never keep more than was delivered', async () => {
  world.order({ items: [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', unitPrice: 1000, quantity: 1, stockDeducted: true }], subtotal: 1000, discountAmount: 0 });
  const results = await Promise.all([request(), request()]);
  const statuses = results.map((r) => r.status);
  assert.ok(statuses.every((status) => status === 201 || status === 422), statuses.join());
  const kept = world.returns.reduce((sum, r) => sum + r.items.reduce((n: number, i: Row) => n + i.quantity, 0), 0);
  assert.ok(kept <= 1, 'at most the delivered quantity is kept: ' + kept);
  assert.equal(world.returns.length, statuses.filter((status) => status === 201).length, 'a refused request leaves no return behind');
});

// ------------------------------------------------------------------------------------------------------------ rate limiting

test('rate limit per order number: many addresses guessing one order are stopped (429)', async () => {
  world.order();
  const statuses: number[] = [];
  for (let i = 0; i < 12; i += 1) statuses.push((await eligibility('ORD-ABCD2345', '03009999999')).status);
  assert.equal(statuses.slice(0, 10).every((status) => status === 404), true, 'the first ten answer');
  assert.equal(statuses[10], 429);
  assert.equal((await eligibility('ORD-ABCD2345', PHONE)).status, 429, 'the right phone is stopped too once the order is hammered');
});

test('rate limit per address: one address trying many order numbers is stopped (429), with Retry-After', async () => {
  world.order();
  const same = { 'x-forwarded-for': '198.51.100.7' };
  const statuses: number[] = [];
  let last: Response | null = null;
  for (let i = 0; i < 12; i += 1) {
    last = await request({}, 'ORD-NOPE000' + String(i), STORE_A, same);
    statuses.push(last.status);
  }
  assert.equal(statuses.slice(0, 10).every((status) => status === 404), true);
  assert.equal(statuses[10], 429);
  assert.ok(Number(last!.headers.get('retry-after')) >= 1);
});

// ------------------------------------------------------------------------------------------------------------ notifications

test('the seller gets ONE email and ONE bell alert of the new kind, each under return:<id>:requested, and a repeat queues nothing', async () => {
  world.order();
  const res = await request();
  assert.equal(res.status, 201);
  await settle();
  assert.equal(world.alerts.length, 1);
  assert.equal(world.alerts[0]!.kind, 'return_requested');
  assert.equal(world.alerts[0]!.link, '/returns');
  const saved = world.returns[0]!;
  assert.equal(world.alerts[0]!.dedupeKey, 'return:' + saved._id + ':requested');
  const email = world.outbox.find((row) => row.template === 'return_requested_seller')!;
  assert.ok(email, 'the seller email is queued');
  assert.equal(email.to, 'a@seller.test');
  assert.equal(email.dedupeKey, 'return:' + saved._id + ':requested');
  assert.ok(email.bodyText.includes(saved.returnNumber));
  await sendReturnRequested(STORE_A, saved, world.orders[0]);
  assert.equal(world.alerts.length, 1);
  assert.equal(world.outbox.filter((row) => row.template === 'return_requested_seller').length, 1);
});
