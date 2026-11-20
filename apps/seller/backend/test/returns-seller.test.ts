import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { installReturnsWorld, settle, ADMIN, ORDER_A, ORDER_B, P1, P2, PHONE, SECRET, STORE_A, STORE_B, USER_A, USER_B, V1, V2, type ReturnsWorld, type Row } from './helpers/returns-world';

// Sprint 5 EP-13.US02 and US03 (D-107, D-108): the seller's return routes under /api/stores/:id/returns: list and detail, approve, reject,
// receive (restock once, the order becomes returned only when everything is back) and refund (cap, parts, COD only, the commission reversal).
// Models are in memory (./helpers/returns-world). Seller B must never read or change Seller A's returns.

type Ctx = { params: Promise<{ id: string; returnId?: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let world: ReturnsWorld;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let listGET: Handler;
let detailGET: Handler;
let approvePOST: Handler;
let rejectPOST: Handler;
let receivePOST: Handler;
let refundPOST: Handler;
let legacy: { PATCH: (r: NextRequest, c: any) => Promise<Response> };

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  listGET = (await import('../src/app/api/stores/[id]/returns/route')).GET as Handler;
  detailGET = (await import('../src/app/api/stores/[id]/returns/[returnId]/route')).GET as Handler;
  approvePOST = (await import('../src/app/api/stores/[id]/returns/[returnId]/approve/route')).POST as Handler;
  rejectPOST = (await import('../src/app/api/stores/[id]/returns/[returnId]/reject/route')).POST as Handler;
  receivePOST = (await import('../src/app/api/stores/[id]/returns/[returnId]/receive/route')).POST as Handler;
  refundPOST = (await import('../src/app/api/stores/[id]/returns/[returnId]/refund/route')).POST as Handler;
  legacy = (await import('../src/app/api/returns/[id]/route')) as any;
});

beforeEach(() => {
  world = installReturnsWorld();
});

afterEach(() => world.restore());

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

function call(handler: Handler, method: string, id: string | undefined, options: { store?: string; token?: string | null; body?: unknown; search?: string } = {}) {
  const store = options.store ?? STORE_A;
  const token = options.token === undefined ? tokenA : options.token;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  return handler(
    new NextRequest('http://seller.test/api/stores/' + store + '/returns' + (id === undefined ? '' : '/' + id) + (options.search ?? ''), {
      method,
      headers,
      body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({ id: store, ...(id === undefined ? {} : { returnId: id }) }) },
  );
}

const json = async (res: Response) => (await res.json()) as any;
const ids = (list: any): string[] => list.docs.map((doc: Row) => doc.id);

/** A delivered COD order and an approved return of every line, ready to be received. */
function approved(fields: Row = {}): Row {
  world.order();
  return world.ret({ status: 'approved', ...fields });
}

/** The whole order received: everything back, restocked. The return is then `received`. */
const ALL_BACK = { items: [{ productId: P1, variantId: V1, quantity: 2, restock: true }, { productId: P2, variantId: V2, quantity: 1, restock: true }] };

async function received(fields: Row = {}): Promise<Row> {
  const ret = approved(fields);
  assert.equal((await call(receivePOST, 'POST', String(ret._id), { body: ALL_BACK })).status, 200);
  return world.returns.find((r) => r._id === ret._id)!;
}

const stored = (id: unknown): Row => world.returns.find((r) => String(r._id) === String(id))!;
const orderRow = (): Row => world.orders.find((o) => String(o._id) === ORDER_A)!;

// ---------------------------------------------------------------------------------------------------------------------
// Access and isolation

test('no login is 401 and an admin session is 403 on every return route; nothing changes', async () => {
  world.order();
  const ret = world.ret();
  const id = String(ret._id);
  for (const [handler, method, body] of [
    [listGET, 'GET', undefined],
    [detailGET, 'GET', undefined],
    [approvePOST, 'POST', undefined],
    [rejectPOST, 'POST', { reason: 'Item was used' }],
    [receivePOST, 'POST', ALL_BACK],
    [refundPOST, 'POST', { amount: 100, method: 'cash' }],
  ] as const) {
    const target = handler === listGET ? undefined : id;
    assert.equal((await call(handler, method, target, { token: null, body })).status, 401);
    assert.equal((await call(handler, method, target, { token: tokenAdmin, body })).status, 403);
  }
  assert.equal(ret.status, 'requested');
  assert.equal(world.returnWrites, 0);
});

test("Seller B cannot read or change Seller A's returns: A's store is 403 on every route, and A's return id under B's own store is 404", async () => {
  world.order();
  const ret = world.ret();
  const id = String(ret._id);
  const probes: Array<[Handler, string, unknown]> = [
    [detailGET, 'GET', undefined],
    [approvePOST, 'POST', undefined],
    [rejectPOST, 'POST', { reason: 'Item was used' }],
    [receivePOST, 'POST', ALL_BACK],
    [refundPOST, 'POST', { amount: 100, method: 'cash' }],
  ];
  assert.equal((await call(listGET, 'GET', undefined, { token: tokenB, store: STORE_A })).status, 403);
  for (const [handler, method, body] of probes) {
    assert.equal((await call(handler, method, id, { token: tokenB, store: STORE_A, body })).status, 403, handler.name);
    assert.equal((await call(handler, method, id, { token: tokenB, store: STORE_B, body })).status, 404, handler.name);
  }
  // A's return never shows in B's list.
  const own = await json(await call(listGET, 'GET', undefined, { token: tokenB, store: STORE_B }));
  assert.equal(own.docs.length, 0);
  assert.equal(JSON.stringify(own).includes(id), false);
  assert.equal(ret.status, 'requested');
  assert.equal(world.returnWrites, 0);
  assert.equal(world.stock[V1], 5);
});

test("a malformed return id is 404, and a return of another store's order is not found through this store", async () => {
  assert.equal((await call(detailGET, 'GET', 'not-an-id')).status, 404);
  assert.equal((await call(approvePOST, 'POST', 'not-an-id')).status, 404);
  const foreign = world.ret({ store: STORE_B });
  assert.equal((await call(detailGET, 'GET', String(foreign._id))).status, 404);
  assert.equal((await call(approvePOST, 'POST', String(foreign._id))).status, 404);
  assert.equal(foreign.status, 'requested');
});

// ---------------------------------------------------------------------------------------------------------------------
// List and detail

test('the list answers ?status= (the dead tabs: the page sent where[status][equals], which was never read) with counts per status', async () => {
  world.order();
  world.ret({ status: 'requested' });
  world.ret({ status: 'requested' });
  world.ret({ status: 'approved' });
  world.ret({ status: 'refunded' });
  world.ret({ status: 'requested', store: STORE_B });
  const all = await json(await call(listGET, 'GET', undefined));
  assert.equal(all.totalDocs, 4);
  assert.deepEqual(all.counts, { requested: 2, approved: 1, rejected: 0, received: 0, refunded: 1, completed: 0, all: 4 });
  const requested = await json(await call(listGET, 'GET', undefined, { search: '?status=requested' }));
  assert.equal(requested.totalDocs, 2);
  assert.ok(requested.docs.every((doc: Row) => doc.status === 'requested'));
  const approvedOnly = await json(await call(listGET, 'GET', undefined, { search: '?status=approved' }));
  assert.equal(approvedOnly.totalDocs, 1);
  // The legacy parameter the old page sent changes nothing here: it is simply not a filter.
  const dead = await json(await call(listGET, 'GET', undefined, { search: '?where[status][equals]=approved' }));
  assert.equal(dead.totalDocs, 4);
});

test('the list is newest first, paged, and a bad status or page is 400 naming the field', async () => {
  world.order();
  for (let i = 0; i < 5; i += 1) world.ret();
  const first = await json(await call(listGET, 'GET', undefined, { search: '?limit=2&page=1' }));
  const second = await json(await call(listGET, 'GET', undefined, { search: '?limit=2&page=2' }));
  assert.deepEqual([first.docs.length, second.docs.length, first.totalPages, first.hasNextPage, second.hasPrevPage], [2, 2, 3, true, true]);
  assert.equal(ids(first).some((id) => ids(second).includes(id)), false, 'pages never overlap');
  assert.ok(Date.parse(first.docs[0].createdAt) >= Date.parse(first.docs[1].createdAt));
  for (const [search, field] of [['?status=maybe', 'status'], ['?page=0', 'page'], ['?limit=500', 'limit']] as const) {
    const res = await call(listGET, 'GET', undefined, { search });
    assert.equal(res.status, 400, search);
    assert.equal((await json(res)).field, field);
  }
});

test('the detail is the seller\'s view: lines, the customer, the cap (null until received), no store or internal id', async () => {
  world.order();
  const ret = world.ret({ description: 'Arrived broken' });
  const res = await call(detailGET, 'GET', String(ret._id));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const view = await json(res);
  assert.equal(view.id, String(ret._id));
  assert.equal(view.returnNumber, ret.returnNumber);
  assert.equal(view.orderNumber, 'ORD-ABCD2345');
  assert.equal(view.status, 'requested');
  assert.equal(view.reasonCode, 'damaged');
  assert.equal(view.note, 'Arrived broken');
  assert.equal(view.customerName, 'Sara Khan');
  assert.equal(view.contactPhone, PHONE);
  assert.equal(view.paymentMethod, 'cod');
  assert.equal(view.refundCap, null);
  assert.equal(view.refundAmount, 0);
  assert.deepEqual(view.items.map((i: Row) => [i.productId, i.quantity, i.unitPrice]), [[P1, 2, 1000], [P2, 1, 500]]);
  assert.equal('store' in view, false);
  assert.equal('_id' in view, false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Approve and reject

test('approve: requested -> approved in one compare-and-set; the customer is emailed once; the seller gets the wa.me decision text', async () => {
  world.order();
  const ret = world.ret();
  const res = await call(approvePOST, 'POST', String(ret._id));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.return.status, 'approved');
  assert.match(body.decisionText, new RegExp(String(ret.returnNumber)));
  assert.match(body.decisionText, /[؀-ۿ]/, 'English then Urdu');
  assert.equal(stored(ret._id).status, 'approved');
  assert.equal(world.returnWrites, 1);
  await settle();
  const email = world.outbox.find((row) => row.template === 'return_approved_customer')!;
  assert.ok(email, 'the customer is told by email when the order has one');
  assert.equal(email.to, 'sara@example.pk');
  assert.equal(email.dedupeKey, 'return:' + ret._id + ':approved');
});

test('approve: no email on the order means no email (the seller has the wa.me text); a second decision is 409 and changes nothing', async () => {
  world.order({ customerEmail: null });
  const ret = world.ret();
  assert.equal((await call(approvePOST, 'POST', String(ret._id))).status, 200);
  await settle();
  assert.equal(world.outbox.filter((row) => row.template === 'return_approved_customer').length, 0);
  const writes = world.returnWrites;
  for (const handler of [approvePOST, rejectPOST]) {
    const again = await call(handler, 'POST', String(ret._id), { body: { reason: 'Item was used' } });
    assert.equal(again.status, 409);
    assert.equal((await json(again)).code, 'RETURN_STATUS_CHANGED');
  }
  assert.equal(world.returnWrites, writes);
  assert.equal(stored(ret._id).status, 'approved');
});

test('approve and reject racing leave ONE decision', async () => {
  world.order();
  const ret = world.ret();
  world.holdReads('return', 2);
  const results = await Promise.all([call(approvePOST, 'POST', String(ret._id)), call(rejectPOST, 'POST', String(ret._id), { body: { reason: 'Item was used' } })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(world.returnWrites, 1);
  assert.ok(['approved', 'rejected'].includes(stored(ret._id).status));
});

test('reject: needs a reason of 5 or more characters (400 on reason); stores it, sets resolvedAt, tells the customer', async () => {
  world.order();
  const ret = world.ret();
  for (const reason of [undefined, '', 'no', '    abc  ', 'x'.repeat(201), '<b>used</b>']) {
    const res = await call(rejectPOST, 'POST', String(ret._id), { body: reason === undefined ? {} : { reason } });
    assert.equal(res.status, 400, String(reason));
    assert.equal((await json(res)).field, 'reason');
  }
  assert.equal((await call(rejectPOST, 'POST', String(ret._id), { body: { reason: 'Item was used', status: 'approved' } })).status, 400, 'unknown field');
  assert.equal(stored(ret._id).status, 'requested');
  const res = await call(rejectPOST, 'POST', String(ret._id), { body: { reason: '  Item was   used  ' } });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.return.status, 'rejected');
  assert.equal(body.return.rejectReason, 'Item was used');
  assert.match(body.decisionText, /Item was used/);
  assert.equal(stored(ret._id).rejectReason, 'Item was used');
  assert.ok(stored(ret._id).resolvedAt instanceof Date);
  await settle();
  const email = world.outbox.find((row) => row.template === 'return_rejected_customer')!;
  assert.ok(email.bodyText.includes('Item was used'), 'the customer is told the reason');
  assert.equal(email.dedupeKey, 'return:' + ret._id + ':rejected');
});

test('audit: a decision names the store and the return number only: never a phone, an email or the reason text', async () => {
  world.order();
  const a = world.ret();
  const b = world.ret();
  await call(approvePOST, 'POST', String(a._id));
  await call(rejectPOST, 'POST', String(b._id), { body: { reason: 'Customer used the shirt' } });
  assert.deepEqual(world.audits.map((x) => x.action), ['return.approve', 'return.reject']);
  for (const audit of world.audits) {
    assert.equal(audit.actorId, 'seller:' + USER_A);
    assert.deepEqual(Object.keys(audit.details).sort(), ['at', 'returnNumber', 'storeId']);
  }
  const text = JSON.stringify(world.audits);
  for (const secret of ['Customer used the shirt', PHONE, '0300', 'sara@example.pk', 'Sara Khan']) assert.equal(text.includes(secret), false, secret);
});

// ---------------------------------------------------------------------------------------------------------------------
// Receive

test('receive: approved -> received, the chosen quantities go back on the shelf ONCE with the return_restock reason', async () => {
  const ret = approved();
  const res = await call(receivePOST, 'POST', String(ret._id), { body: ALL_BACK });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.return.status, 'received');
  assert.equal(body.orderReturned, true, 'everything is back, so the order is returned');
  assert.equal(body.stockRestore.restored.length, 2);
  assert.deepEqual(world.stock, { [V1]: 7, [V2]: 6 });
  assert.equal(world.movements.length, 2);
  for (const movement of world.movements) {
    assert.equal(movement.reason, 'return_restock');
    assert.equal(String(movement.orderId), ORDER_A);
    assert.equal(String(movement.actor), USER_A);
  }
  assert.deepEqual(world.movements.map((m) => m.delta).sort(), [1, 2]);
  assert.deepEqual(stored(ret._id).received, [
    { productId: P1, variantId: V1, quantity: 2, restock: true },
    { productId: P2, variantId: V2, quantity: 1, restock: true },
  ]);
  assert.equal(body.return.refundCap, 2250, 'price of what came back, less the discount share, without delivery');
});

test('receive: a repeat, or a parallel request, restocks nothing twice', async () => {
  const ret = approved();
  world.holdReads('return', 2);
  const results = await Promise.all([call(receivePOST, 'POST', String(ret._id), { body: ALL_BACK }), call(receivePOST, 'POST', String(ret._id), { body: ALL_BACK })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(world.stock, { [V1]: 7, [V2]: 6 }, 'restocked once');
  assert.equal(world.movements.length, 2);
  const again = await call(receivePOST, 'POST', String(ret._id), { body: ALL_BACK });
  assert.equal(again.status, 409);
  assert.deepEqual(world.stock, { [V1]: 7, [V2]: 6 });
});

test('receive: only the lines marked restock go back on the shelf, and only up to what was asked for', async () => {
  const ret = approved();
  const res = await call(receivePOST, 'POST', String(ret._id), { body: { items: [{ productId: P1, variantId: V1, quantity: 1, restock: false }, { productId: P2, variantId: V2, quantity: 1, restock: true }] } });
  assert.equal(res.status, 200);
  assert.deepEqual(world.stock, { [V1]: 5, [V2]: 6 });
  assert.equal(world.movements.length, 1);
  assert.equal((await json(res)).orderReturned, false, 'one of the two P1 units is still out');
  assert.equal(orderRow().status, 'delivered');
});

test('receive: more than was asked for, an item that is not in the return, or the same item twice is 400 and changes nothing', async () => {
  const ret = approved();
  const cases: Array<[unknown, string]> = [
    [{ items: [{ productId: P1, variantId: V1, quantity: 3, restock: true }] }, 'items.0.quantity'],
    [{ items: [{ productId: P1, variantId: V2, quantity: 1, restock: true }] }, 'items.0.productId'],
    [{ items: [{ productId: P1, variantId: V1, quantity: 1, restock: true }, { productId: P1, variantId: V1, quantity: 1, restock: true }] }, 'items.1.productId'],
    [{ items: [] }, 'items'],
    [{ items: [{ productId: P1, variantId: V1, quantity: 1 }] }, 'items.0.restock'],
    [{}, 'items'],
  ];
  for (const [body, field] of cases) {
    const res = await call(receivePOST, 'POST', String(ret._id), { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await json(res)).field, field, JSON.stringify(body));
  }
  assert.equal(stored(ret._id).status, 'approved');
  assert.deepEqual(world.stock, { [V1]: 5, [V2]: 5 });
  assert.equal(world.movements.length, 0);
});

test('receive: only an approved return can be received (requested, rejected and already received answer 409)', async () => {
  world.order();
  const requested = world.ret({ status: 'requested' });
  const rejected = world.ret({ status: 'rejected' });
  for (const ret of [requested, rejected]) {
    const res = await call(receivePOST, 'POST', String(ret._id), { body: ALL_BACK });
    assert.equal(res.status, 409);
    assert.equal(ret.received, undefined);
  }
  assert.deepEqual(world.stock, { [V1]: 5, [V2]: 5 });
});

test('the order becomes returned only when EVERY delivered quantity has been received across its returns; a partial return leaves it delivered', async () => {
  world.order();
  const first = world.ret({ status: 'approved', items: [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 2, unitPrice: 1000 }] });
  const second = world.ret({ status: 'approved', items: [{ productId: P2, variantId: V2, productTitle: 'Cap', variantTitle: 'Default', quantity: 1, unitPrice: 500 }] });
  const partial = await call(receivePOST, 'POST', String(first._id), { body: { items: [{ productId: P1, variantId: V1, quantity: 2, restock: true }] } });
  assert.equal((await json(partial)).orderReturned, false);
  assert.equal(orderRow().status, 'delivered', 'a partial return leaves the order delivered');
  assert.equal(world.orderWrites, 0);
  const last = await call(receivePOST, 'POST', String(second._id), { body: { items: [{ productId: P2, variantId: V2, quantity: 1, restock: false }] } });
  assert.equal((await json(last)).orderReturned, true);
  assert.equal(orderRow().status, 'returned');
  assert.equal(world.orderWrites, 1, 'one compare-and-set on the order');
  const entry = orderRow().statusHistory[orderRow().statusHistory.length - 1];
  assert.deepEqual([entry.from, entry.to, String(entry.by)], ['delivered', 'returned', USER_A]);
  assert.ok(world.audits.some((a) => a.action === 'order.returned'));
});

test('receiving less than was asked for does not return the order', async () => {
  const ret = approved();
  await call(receivePOST, 'POST', String(ret._id), { body: { items: [{ productId: P1, variantId: V1, quantity: 1, restock: true }, { productId: P2, variantId: V2, quantity: 1, restock: true }] } });
  assert.equal(orderRow().status, 'delivered');
  assert.equal(world.orderWrites, 0);
});

test('the order flow is not changed: the transition route still refuses delivered -> returned', async () => {
  const { canTransition } = await import('@/lib/contracts');
  assert.equal(canTransition('delivered', 'returned'), false, 'the order only becomes returned through the receive route');
});

test('audit of a receive: counts and ids only', async () => {
  const ret = approved();
  await call(receivePOST, 'POST', String(ret._id), { body: ALL_BACK });
  const audit = world.audits.find((a) => a.action === 'return.receive')!;
  assert.deepEqual(Object.keys(audit.details).sort(), ['at', 'failed', 'lines', 'orderReturned', 'restocked', 'returnNumber', 'skipped', 'storeId', 'summary']);
  assert.equal(audit.details.restocked, 2);
  assert.equal(JSON.stringify(world.audits).includes(PHONE), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Refund

const cod = (base: number, commission: number) => world.ledger.push({ _id: 'c1', store: STORE_A, order: ORDER_A, type: 'cod_commission', balanceEffect: -commission, baseAmount: base, rate: 4, reversesType: null, returnId: null, settledAt: null, payoutId: null, createdAt: new Date() });
const reversals = () => world.ledger.filter((e) => e.type === 'reversal');

test('refund: only after the return was received (requested and approved answer 409)', async () => {
  world.order();
  const requested = world.ret({ status: 'requested' });
  const approvedReturn = world.ret({ status: 'approved' });
  for (const ret of [requested, approvedReturn]) {
    const res = await call(refundPOST, 'POST', String(ret._id), { body: { amount: 100, method: 'cash' } });
    assert.equal(res.status, 409);
    assert.equal(ret.refundAmount, null);
  }
});

test('refund: a card order answers 422 CARD_REFUND_UNSUPPORTED (card is off and card refunds belong to the gateways epic)', async () => {
  world.order({ paymentMethod: 'card', paymentStatus: 'paid' });
  const ret = world.ret({ status: 'received', received: [{ productId: P1, variantId: V1, quantity: 2, restock: true }] });
  const res = await call(refundPOST, 'POST', String(ret._id), { body: { amount: 100, method: 'bank' } });
  assert.equal(res.status, 422);
  assert.equal((await json(res)).code, 'CARD_REFUND_UNSUPPORTED');
  assert.equal(ret.refundAmount, null);
  assert.equal(ret.refunds, undefined);
  assert.equal(world.ledger.length, 0);
});

test('refund: between Rs. 1 and what is left of the paid value of what came back; the whole order is 2250 (2500 less the 250 discount, delivery excluded)', async () => {
  const ret = await received();
  const view = await json(await call(detailGET, 'GET', String(ret._id)));
  assert.equal(view.refundCap, 2250);
  const tooMuch = await call(refundPOST, 'POST', String(ret._id), { body: { amount: 2251, method: 'cash' } });
  assert.equal(tooMuch.status, 422);
  const answer = await json(tooMuch);
  assert.equal(answer.code, 'REFUND_EXCEEDS_CAP');
  assert.equal(answer.field, 'amount');
  assert.equal(stored(ret._id).refundAmount, null, 'nothing was recorded');
  for (const amount of [0, -1, 1.5, '100']) assert.equal((await call(refundPOST, 'POST', String(ret._id), { body: { amount, method: 'cash' } })).status, 400, String(amount));
  assert.equal((await call(refundPOST, 'POST', String(ret._id), { body: { amount: 100, method: 'stripe' } })).status, 400);
  assert.equal((await call(refundPOST, 'POST', String(ret._id), { body: { amount: 100, method: 'cash', refundAmount: 5 } })).status, 400, 'the running total is not a field a seller sends');
});

test('refund: recordable in parts up to the cap; the return is refunded when the cap is reached, and then nothing more can be recorded', async () => {
  const ret = await received();
  const first = await call(refundPOST, 'POST', String(ret._id), { body: { amount: 1000, method: 'jazzcash', reference: 'JC-778812' } });
  assert.equal(first.status, 200);
  const one = await json(first);
  assert.equal(one.completed, false);
  assert.equal(one.return.status, 'received', 'still open: the cap is not reached');
  assert.equal(one.return.refundAmount, 1000);
  assert.equal(stored(ret._id).refundAmount, 1000, 'the running total');
  const second = await json(await call(refundPOST, 'POST', String(ret._id), { body: { amount: 1250, method: 'cash' } }));
  assert.equal(second.completed, true);
  assert.equal(second.return.status, 'refunded');
  assert.equal(second.return.refundAmount, 2250);
  assert.ok(stored(ret._id).resolvedAt instanceof Date);
  assert.deepEqual(stored(ret._id).refunds.map((r: Row) => [r.amount, r.method, r.reference, String(r.by)]), [
    [1000, 'jazzcash', 'JC-778812', USER_A],
    [1250, 'cash', null, USER_A],
  ]);
  assert.equal(stored(ret._id).refunds.reduce((sum: number, r: Row) => sum + r.amount, 0), stored(ret._id).refundAmount, 'the running total is the sum of the entries');
  const third = await call(refundPOST, 'POST', String(ret._id), { body: { amount: 1, method: 'cash' } });
  assert.equal(third.status, 409);
  assert.equal(stored(ret._id).refundAmount, 2250);
});

test('refund: a part more than what is left is refused with what is left in the message', async () => {
  const ret = await received();
  await call(refundPOST, 'POST', String(ret._id), { body: { amount: 2000, method: 'cash' } });
  const res = await call(refundPOST, 'POST', String(ret._id), { body: { amount: 251, method: 'cash' } });
  assert.equal(res.status, 422);
  assert.match((await json(res)).errors[0].message, /250/);
  assert.equal((await call(refundPOST, 'POST', String(ret._id), { body: { amount: 250, method: 'cash' } })).status, 200);
});

test('refund: two parallel refunds leave a correct sum: one wins, the other reads 409', async () => {
  const ret = await received();
  world.holdReads('return', 2);
  const results = await Promise.all([
    call(refundPOST, 'POST', String(ret._id), { body: { amount: 1500, method: 'cash' } }),
    call(refundPOST, 'POST', String(ret._id), { body: { amount: 1500, method: 'bank' } }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(stored(ret._id).refundAmount, 1500, 'never 3000, never above the cap');
  assert.equal(stored(ret._id).refunds.length, 1);
});

test('refund: the cap is the paid value of what was RECEIVED, with its discount share, and delivery is never in it', async () => {
  world.order();
  // One shirt asked for and received: gross 1000, discount share round(250 x 1000 / 2500) = 100, so 900.
  const ret = world.ret({ status: 'approved', items: [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 1, unitPrice: 1000 }] });
  await call(receivePOST, 'POST', String(ret._id), { body: { items: [{ productId: P1, variantId: V1, quantity: 1, restock: true }] } });
  const view = await json(await call(detailGET, 'GET', String(ret._id)));
  assert.equal(view.refundCap, 900);
  assert.equal((await call(refundPOST, 'POST', String(ret._id), { body: { amount: 901, method: 'cash' } })).status, 422);
  assert.equal((await call(refundPOST, 'POST', String(ret._id), { body: { amount: 900, method: 'cash' } })).status, 200);
  assert.equal(stored(ret._id).status, 'refunded');
});

test('refund: writes ONE proportional commission reversal for the return, with the first refund; later refunds of the same return write none', async () => {
  const ret = await received();
  cod(2250, 90);
  const first = await json(await call(refundPOST, 'POST', String(ret._id), { body: { amount: 1000, method: 'cash' } }));
  assert.equal(first.commissionReversed, 90, 'everything came back, so the whole commission');
  assert.equal(reversals().length, 1);
  assert.equal(reversals()[0]!.balanceEffect, 90);
  assert.equal(String(reversals()[0]!.returnId), String(ret._id));
  const second = await json(await call(refundPOST, 'POST', String(ret._id), { body: { amount: 1250, method: 'cash' } }));
  assert.equal(second.commissionReversed, 0);
  assert.equal(reversals().length, 1, 'one reversal per return');
});

test('refund: a partial return reverses its share, a second partial return of the same order does not collide, and the sum never exceeds the original', async () => {
  world.order();
  cod(2250, 90);
  const one = world.ret({ status: 'approved', items: [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 1, unitPrice: 1000 }] });
  const two = world.ret({ status: 'approved', items: [{ productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 1, unitPrice: 1000 }, { productId: P2, variantId: V2, productTitle: 'Cap', variantTitle: 'Default', quantity: 1, unitPrice: 500 }] });
  await call(receivePOST, 'POST', String(one._id), { body: { items: [{ productId: P1, variantId: V1, quantity: 1, restock: true }] } });
  await call(receivePOST, 'POST', String(two._id), { body: { items: [{ productId: P1, variantId: V1, quantity: 1, restock: true }, { productId: P2, variantId: V2, quantity: 1, restock: true }] } });
  // Return one: base 900 of 2250 -> round(90 x 900 / 2250) = 36.
  const a = await json(await call(refundPOST, 'POST', String(one._id), { body: { amount: 900, method: 'cash' } }));
  assert.equal(a.commissionReversed, 36);
  // Return two: base 1500 less its discount share round(250 x 1500 / 2500) = 150 -> 1350; with 900 already, 900 + 1350 = 2250 = the order base: it takes the remainder, 54.
  const b = await json(await call(refundPOST, 'POST', String(two._id), { body: { amount: 1350, method: 'cash' } }));
  assert.equal(b.commissionReversed, 54);
  assert.equal(reversals().length, 2);
  assert.equal(reversals().reduce((sum, e) => sum + e.balanceEffect, 0), 90, 'exactly the original commission, never more');
});

test('refund: an order with no commission entry still records the refund and reverses nothing', async () => {
  const ret = await received();
  const res = await json(await call(refundPOST, 'POST', String(ret._id), { body: { amount: 500, method: 'cash' } }));
  assert.equal(res.commissionReversed, 0);
  assert.equal(world.ledger.length, 0);
  assert.equal(stored(ret._id).refundAmount, 500);
});

test('audit of a refund: the return number, the rupee amount and the method; never the reference, a phone or an email', async () => {
  const ret = await received();
  await call(refundPOST, 'POST', String(ret._id), { body: { amount: 500, method: 'bank', reference: 'IBAN-PK00-SECRET-REF' } });
  const audit = world.audits.find((a) => a.action === 'return.refund')!;
  assert.deepEqual(Object.keys(audit.details).sort(), ['amount', 'at', 'completed', 'method', 'returnNumber', 'storeId']);
  const text = JSON.stringify(world.audits);
  for (const secret of ['IBAN-PK00-SECRET-REF', PHONE, 'sara@example.pk']) assert.equal(text.includes(secret), false, secret);
});

// ---------------------------------------------------------------------------------------------------------------------
// The generic PATCH keeps working but cannot bypass the actions

test('the generic PATCH still approves, but cannot move a return to received or refunded, nor change the refund of one that has', async () => {
  world.order();
  const ret = world.ret();
  const patch = (id: string, body: unknown) =>
    legacy.PATCH(
      new NextRequest('http://seller.test/api/returns/' + id, { method: 'PATCH', headers: { authorization: 'Bearer ' + tokenA, 'content-type': 'application/json', 'x-store-id': STORE_A }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id }) },
    );
  assert.equal((await patch(String(ret._id), { status: 'approved' })).status, 200);
  assert.equal((await patch(String(ret._id), { status: 'received' })).status, 409, 'receiving has its own action (restock, order returned)');
  assert.equal(stored(ret._id).status, 'approved');
  const done = world.ret({ status: 'received', refundAmount: 500 });
  assert.equal((await patch(String(done._id), { refundAmount: 99999 })).status, 409, 'the refund is recorded with the refund action');
  assert.equal(done.refundAmount, 500);
  assert.equal((await patch(String(done._id), { status: 'refunded' })).status, 409);
});
