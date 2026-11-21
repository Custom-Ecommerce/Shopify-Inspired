import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { Order, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { installReturnsWorld, ORDER_A, P1, P2, SECRET, STORE_A, USER_A, V1, V2, type ReturnsWorld, type Row } from './helpers/returns-world';

// SB-6: the refund cap in the seller's LIST (verification bug 8: it was null, so the page hid "Record a refund") and the return that completes the
// received quantities of the whole order (verification bug 6: split returns reversed 1 rupee less than the commission). Through the real routes,
// with the models in memory (./helpers/returns-world).

type Ctx = { params: Promise<{ id: string; returnId?: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let world: ReturnsWorld;
let tokenA = '';
let listGET: Handler;
let detailGET: Handler;
let receivePOST: Handler;
let refundPOST: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  listGET = (await import('../src/app/api/stores/[id]/returns/route')).GET as Handler;
  detailGET = (await import('../src/app/api/stores/[id]/returns/[returnId]/route')).GET as Handler;
  receivePOST = (await import('../src/app/api/stores/[id]/returns/[returnId]/receive/route')).POST as Handler;
  refundPOST = (await import('../src/app/api/stores/[id]/returns/[returnId]/refund/route')).POST as Handler;
});

beforeEach(() => {
  world = installReturnsWorld();
});

afterEach(() => world.restore());

function call(handler: Handler, method: string, id: string | undefined, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: 'Bearer ' + tokenA };
  return handler(
    new NextRequest('http://seller.test/api/stores/' + STORE_A + '/returns' + (id === undefined ? '' : '/' + id), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: STORE_A, ...(id === undefined ? {} : { returnId: id }) }) },
  );
}
const json = async (res: Response) => (await res.json()) as any;
const cod = (base: number, commission: number) =>
  world.ledger.push({ _id: 'c1', store: STORE_A, order: ORDER_A, type: 'cod_commission', balanceEffect: -commission, baseAmount: base, rate: 4, reversesType: null, returnId: null, settledAt: null, payoutId: null, createdAt: new Date() });
const reversals = () => world.ledger.filter((e) => e.type === 'reversal');
const orderRow = (): Row => world.orders.find((o) => String(o._id) === ORDER_A)!;
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
const capOf = async (ret: Row): Promise<number> => (await json(await call(detailGET, 'GET', String(ret._id)))).refundCap;

/** The verification order: P1 1000 x1 + P2 500 x2 = 2000, a discount of 150 (commission base 1850, commission 74 at 4 %). */
function splitOrder(): void {
  world.order({
    subtotal: 2000,
    discountAmount: 150,
    total: 2050,
    items: [
      { productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', sku: 'SH-M', unitPrice: 1000, quantity: 1, stockDeducted: true },
      { productId: P2, variantId: V2, productTitle: 'Cap', variantTitle: 'Default', sku: null, unitPrice: 500, quantity: 2, stockDeducted: true },
    ],
  });
}
const asked = (productId: string, variantId: string, unitPrice: number) => [{ productId, variantId, productTitle: 'x', variantTitle: 'x', quantity: 1, unitPrice }];
const back = (productId: string, variantId: string) => ({ items: [{ productId, variantId, quantity: 1, restock: true }] });
type Line = [string, string];

async function receiveAll(order: Array<[Row, Line]>): Promise<void> {
  for (const [ret, line] of order) {
    assert.equal((await call(receivePOST, 'POST', String(ret._id), back(line[0], line[1]))).status, 200);
    await pause();
  }
}

test('SB-6 (bug 8): the LIST sends the same refundCap as the detail, with ONE order query for the page', async () => {
  world.order();
  const ret = world.ret({ status: 'approved' });
  const all = { items: [{ productId: P1, variantId: V1, quantity: 2, restock: true }, { productId: P2, variantId: V2, quantity: 1, restock: true }] };
  assert.equal((await call(receivePOST, 'POST', String(ret._id), all)).status, 200);
  world.ret({ status: 'requested', returnNumber: 'RET-WAITING1' });
  const OrderModel = Order as any;
  const find = OrderModel.find;
  let orderQueries = 0;
  OrderModel.find = (...args: unknown[]) => {
    orderQueries += 1;
    return find.apply(OrderModel, args);
  };
  let list: any;
  try {
    list = await json(await call(listGET, 'GET', undefined));
  } finally {
    OrderModel.find = find;
  }
  const row = list.docs.find((doc: Row) => doc.id === String(ret._id));
  assert.equal(row.refundCap, 2250, 'price of what came back, less the discount share, without delivery');
  assert.equal(row.refundCap, await capOf(ret), 'the list and the detail give the same cap');
  assert.equal(row.paymentMethod, 'cod');
  assert.equal(list.docs.find((doc: Row) => doc.returnNumber === 'RET-WAITING1').refundCap, null, 'a return not received yet has no cap');
  assert.equal(orderQueries, 1, 'the orders of the page are read in one query, not one per row');
});

test('SB-6 (bug 6): three split returns of the 2000 / 150 order: caps 925 + 462 + 463 = 1850, refunds up to the caps, reversals 37 + 18 + 19 = 74', async () => {
  splitOrder();
  cod(1850, 74);
  const r1 = world.ret({ status: 'approved', items: asked(P1, V1, 1000) });
  const r2 = world.ret({ status: 'approved', items: asked(P2, V2, 500) });
  const r3 = world.ret({ status: 'approved', items: asked(P2, V2, 500) });
  await receiveAll([[r1, [P1, V1]], [r2, [P2, V2]], [r3, [P2, V2]]]);
  const caps = [await capOf(r1), await capOf(r2), await capOf(r3)];
  assert.deepEqual(caps, [925, 462, 463]);
  assert.equal(caps.reduce((a, b) => a + b, 0), 1850, 'the caps add up to the order base (the old rule: 1849)');
  const view = await json(await call(listGET, 'GET', undefined));
  assert.deepEqual([r1, r2, r3].map((r) => view.docs.find((d: Row) => d.id === String(r._id)).refundCap), [925, 462, 463], 'the list agrees');

  assert.equal((await call(refundPOST, 'POST', String(r3._id), { amount: 464, method: 'cash' })).status, 422, 'the last cap is 463, not 464');
  for (const [ret, cap] of [[r1, 925], [r2, 462], [r3, 463]] as Array<[Row, number]>) {
    const res = await call(refundPOST, 'POST', String(ret._id), { amount: cap, method: 'bank' });
    assert.equal(res.status, 200, String(cap));
    assert.equal((await json(res)).return.status, 'refunded');
  }
  assert.deepEqual(reversals().map((e) => e.balanceEffect), [37, 18, 19]);
  assert.equal(reversals().reduce((sum, e) => sum + e.balanceEffect, 0), 74, 'the reversals add up to the full commission (the old rule: 73)');
  assert.equal(orderRow().status, 'returned');
});

test('SB-6 (bug 6): returns received in a different order: the last one received completes the order, whichever it is', async () => {
  splitOrder();
  cod(1850, 74);
  const r1 = world.ret({ status: 'approved', items: asked(P1, V1, 1000) });
  const r2 = world.ret({ status: 'approved', items: asked(P2, V2, 500) });
  const r3 = world.ret({ status: 'approved', items: asked(P2, V2, 500) });
  // the kurta (asked for first) is the last to arrive
  await receiveAll([[r3, [P2, V2]], [r2, [P2, V2]], [r1, [P1, V1]]]);
  const caps = [await capOf(r1), await capOf(r2), await capOf(r3)];
  assert.deepEqual(caps, [926, 462, 462], 'the kurta return arrived last: 1850 - 462 - 462');
  assert.equal(caps.reduce((a, b) => a + b, 0), 1850);
  for (const [ret, cap] of [[r3, 462], [r2, 462], [r1, 926]] as Array<[Row, number]>) {
    assert.equal((await call(refundPOST, 'POST', String(ret._id), { amount: cap, method: 'cash' })).status, 200);
  }
  assert.equal(reversals().reduce((sum, e) => sum + e.balanceEffect, 0), 74);
  assert.deepEqual(reversals().map((e) => e.balanceEffect), [18, 18, 38], 'proportional for the two earlier ones, the rest (74 - 36) for the one that completes');
});

test('SB-6 (bug 6): two partial returns that do not complete the order stay proportional', async () => {
  splitOrder();
  cod(1850, 74);
  const r1 = world.ret({ status: 'approved', items: asked(P1, V1, 1000) });
  const r2 = world.ret({ status: 'approved', items: asked(P2, V2, 500) });
  await receiveAll([[r1, [P1, V1]], [r2, [P2, V2]]]);
  assert.deepEqual([await capOf(r1), await capOf(r2)], [925, 462], 'the third unit is still with the shopper: no remainder yet');
  assert.equal(orderRow().status, 'delivered');
  for (const [ret, cap] of [[r1, 925], [r2, 462]] as Array<[Row, number]>) assert.equal((await call(refundPOST, 'POST', String(ret._id), { amount: cap, method: 'cash' })).status, 200);
  assert.deepEqual(reversals().map((e) => e.balanceEffect), [37, 18]);
});

test('SB-6 (bug 6): a single return of the whole order takes the whole base and the whole commission', async () => {
  splitOrder();
  cod(1850, 74);
  const whole = world.ret({
    status: 'approved',
    items: [
      { productId: P1, variantId: V1, productTitle: 'x', variantTitle: 'x', quantity: 1, unitPrice: 1000 },
      { productId: P2, variantId: V2, productTitle: 'x', variantTitle: 'x', quantity: 2, unitPrice: 500 },
    ],
  });
  const all = { items: [{ productId: P1, variantId: V1, quantity: 1, restock: true }, { productId: P2, variantId: V2, quantity: 2, restock: true }] };
  assert.equal((await call(receivePOST, 'POST', String(whole._id), all)).status, 200);
  assert.equal(await capOf(whole), 1850);
  assert.equal((await call(refundPOST, 'POST', String(whole._id), { amount: 1850, method: 'bank' })).status, 200);
  assert.deepEqual(reversals().map((e) => e.balanceEffect), [74]);
});
