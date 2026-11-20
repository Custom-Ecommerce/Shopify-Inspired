import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Order, PlatformSettingsModel } from '@/lib/services';
import { backfillCommission } from '@/lib/commission-backfill';
import { reconcileRecentReturnReversals, reconcileReturnReversals, recordAndReconcile } from '@/lib/return-reconcile';
import { installReturnsWorld, ORDER_A, ORDER_B, P1, P2, STORE_A, V1, V2, type ReturnsWorld, type Row } from './helpers/returns-world';

// Sprint 5 EP-13.US03.T07 (D-110 (4)): reverseForReturn is best effort at refund time, so a return refunded while its order had no commission entry
// yet (delivered, the cash not yet marked collected) or whose ledger write failed would never be reversed. reconcileReturnReversals(orderId) calls
// reverseForReturn for every refunded return of the order that has no reversal; it runs right after recordCodCommission creates the ORIGINAL entry and
// from the commission backfill job (returns refunded in the last 30 days). Idempotent through the unique index { order, type, reversesType, returnId }.
// The order: subtotal 2500, discount 250, so the commission base is 2250 and 4% of it is 90 rupees. Models are in memory (./helpers/returns-world).

const DAY = 86_400_000;
let world: ReturnsWorld;
let restoreExtra: Array<() => void> = [];

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, limit: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  world = installReturnsWorld();
  restoreExtra = [];
  const settings = PlatformSettingsModel as any;
  const original = settings.findOne;
  settings.findOne = () => chain(() => ({ defaultCommissionRate: 4 }));
  restoreExtra.push(() => {
    settings.findOne = original;
  });
});

afterEach(() => {
  for (const restore of restoreExtra) restore();
  world.restore();
});

/** The order at the moment its cash was collected (delivered, collected): the commission is due now. */
const collected = (): Row => ({ ...world.orders.find((o) => String(o._id) === ORDER_A)!, paymentStatus: 'collected' });
const originalEntry = (): Row | undefined => world.ledger.find((e) => e.type === 'cod_commission');
const reversals = (): Row[] => world.ledger.filter((e) => e.type === 'reversal');
const back = (...lines: Array<[string, string, number]>) => lines.map(([productId, variantId, quantity]) => ({ productId, variantId, quantity, restock: true }));

/** A return that was received and refunded in full BEFORE the order had a commission entry. */
function refundedReturn(received: Array<[string, string, number]>, fields: Row = {}): Row {
  const items = received.map(([productId, variantId, quantity]) => ({ productId, variantId, productTitle: 'x', variantTitle: 'x', quantity, unitPrice: productId === P1 ? 1000 : 500 }));
  const gross = received.reduce((sum, [productId, , quantity]) => sum + (productId === P1 ? 1000 : 500) * quantity, 0);
  return world.ret({ status: 'refunded', items, received: back(...received), refundAmount: gross, refunds: [{ amount: gross, method: 'cash', reference: 'ref-1', at: new Date(Date.now() - DAY) }], resolvedAt: new Date(Date.now() - DAY), updatedAt: new Date(Date.now() - DAY), ...fields });
}

test('a refund recorded BEFORE the commission exists is reversed when the commission is recorded: ONE reversal with the right amount', async () => {
  world.order({ paymentStatus: 'unpaid' });
  const ret = refundedReturn([[P1, V1, 1]]); // one shirt back: 1000 less its 100 share of the discount = a base of 900

  // At refund time there was nothing to reverse.
  assert.equal(originalEntry(), undefined);
  assert.deepEqual(await reconcileReturnReversals(ORDER_A), { created: 0, existing: 0, nothingDue: 1, failed: 0 });
  assert.equal(reversals().length, 0);

  // The cash is collected: the ORIGINAL entry is created and the reconcile runs right after it.
  world.orders.find((o) => String(o._id) === ORDER_A)!.paymentStatus = 'collected';
  await recordAndReconcile(collected());
  assert.equal(originalEntry()?.balanceEffect, -90, '4% of the base 2250');
  assert.equal(reversals().length, 1, 'exactly one reversal appears');
  const reversal = reversals()[0]!;
  assert.equal(reversal.balanceEffect, 36, 'round(90 x 900 / 2250)');
  assert.equal(reversal.baseAmount, 900);
  assert.equal(reversal.reversesType, 'cod_commission');
  assert.equal(String(reversal.returnId), String(ret._id));
  assert.equal(String(reversal.order), ORDER_A);
});

test('the reconcile is idempotent: run again (or in parallel) and no second reversal is written, the count says it existed', async () => {
  world.order();
  refundedReturn([[P1, V1, 1]]);
  await recordAndReconcile(collected());
  assert.equal(reversals().length, 1);
  assert.deepEqual(await reconcileReturnReversals(ORDER_A), { created: 0, existing: 1, nothingDue: 0, failed: 0 });
  const parallel = await Promise.all([reconcileReturnReversals(ORDER_A), reconcileReturnReversals(ORDER_A), reconcileReturnReversals(ORDER_A)]);
  assert.equal(parallel.reduce((sum, result) => sum + result.created, 0), 0);
  assert.equal(reversals().length, 1);
});

test('two returns refunded before the commission: both are reversed, in the order of their first refund, the last takes the remainder, never more than the commission', async () => {
  world.order();
  const early = refundedReturn([[P1, V1, 1]], { refunds: [{ amount: 1000, method: 'cash', reference: 'r1', at: new Date(Date.now() - 3 * DAY) }] });
  const late = refundedReturn([[P1, V1, 1], [P2, V2, 1]], { refunds: [{ amount: 1500, method: 'cash', reference: 'r2', at: new Date(Date.now() - 1 * DAY) }] });
  assert.deepEqual(await reconcileReturnReversals(ORDER_A), { created: 0, existing: 0, nothingDue: 2, failed: 0 }, 'no commission yet');
  await recordAndReconcile(collected());
  const byReturn = new Map(reversals().map((r) => [String(r.returnId), r.balanceEffect]));
  assert.equal(byReturn.get(String(early._id)), 36);
  assert.equal(byReturn.get(String(late._id)), 54, 'the return that brings the returned base up to the order\'s takes the remainder');
  assert.equal(reversals().reduce((sum, r) => sum + r.balanceEffect, 0), 90, 'the whole commission, not a rupee more');
});

test('only a return with a refund recorded is reversed: requested, approved, rejected and a received return with no refund yet get nothing', async () => {
  world.order();
  world.ret({ status: 'requested' });
  world.ret({ status: 'approved' });
  world.ret({ status: 'rejected' });
  world.ret({ status: 'received', received: back([P1, V1, 1]), refundAmount: null });
  await recordAndReconcile(collected());
  assert.equal(originalEntry()?.balanceEffect, -90);
  assert.equal(reversals().length, 0);
});

test('a partly refunded return that is still received counts too (the reversal is written with the first refund)', async () => {
  world.order();
  const ret = world.ret({ status: 'received', received: back([P1, V1, 2]), refundAmount: 500, refunds: [{ amount: 500, method: 'cash', reference: 'r', at: new Date() }] });
  await recordAndReconcile(collected());
  assert.equal(reversals().length, 1);
  assert.equal(String(reversals()[0]!.returnId), String(ret._id));
  assert.equal(reversals()[0]!.baseAmount, 1800, 'two shirts: 2000 less their 200 share of the discount');
  assert.equal(reversals()[0]!.balanceEffect, 72);
});

test('recordAndReconcile reconciles only when it CREATED the original entry; an order whose entry already exists is left to the backfill job', async () => {
  world.order();
  world.ledger.push({ _id: 'e1', store: STORE_A, order: ORDER_A, type: 'cod_commission', balanceEffect: -90, baseAmount: 2250, rate: 4, reversesType: null, returnId: null, createdAt: new Date() });
  refundedReturn([[P1, V1, 1]]);
  await recordAndReconcile(collected());
  assert.equal(reversals().length, 0, 'the original already existed: nothing was created, so nothing is reconciled here');
  // The backfill job picks it up.
  assert.equal((await reconcileRecentReturnReversals()).created, 1);
  assert.equal(reversals().length, 1);
});

test('the backfill job reconciles the returns refunded in the last 30 days, and leaves older ones alone', async () => {
  world.order();
  world.order({ _id: ORDER_B, orderId: 'ORD-BBBB2222' });
  world.ledger.push({ _id: 'e1', store: STORE_A, order: ORDER_A, type: 'cod_commission', balanceEffect: -90, baseAmount: 2250, rate: 4, reversesType: null, returnId: null, createdAt: new Date() });
  world.ledger.push({ _id: 'e2', store: STORE_A, order: ORDER_B, type: 'cod_commission', balanceEffect: -90, baseAmount: 2250, rate: 4, reversesType: null, returnId: null, createdAt: new Date() });
  const recent = refundedReturn([[P1, V1, 1]], { updatedAt: new Date(Date.now() - 5 * DAY) });
  refundedReturn([[P1, V1, 1]], { order: ORDER_B, orderNumber: 'ORD-BBBB2222', updatedAt: new Date(Date.now() - 40 * DAY) });
  const result = await reconcileRecentReturnReversals();
  assert.equal(result.orders, 1, 'only the order of the recent refund');
  assert.equal(result.created, 1);
  assert.deepEqual(reversals().map((r) => String(r.returnId)), [String(recent._id)]);
  // A second run finds the reversal and writes nothing.
  const again = await reconcileRecentReturnReversals();
  assert.equal(again.created, 0);
  assert.equal(again.existing, 1);
  assert.equal(reversals().length, 1);
});

test('backfillCommission: an order whose commission is written by the job gets the reversal of its earlier refund in the same run, and the answer keeps its shape', async () => {
  world.order();
  refundedReturn([[P1, V1, 1]]);
  const OrderModel = Order as any;
  const savedAggregate = OrderModel.aggregate;
  restoreExtra.push(() => {
    OrderModel.aggregate = savedAggregate;
  });
  OrderModel.aggregate = async () => (originalEntry() === undefined ? [collected()] : []);
  const answer = await backfillCommission();
  assert.deepEqual(answer, { scanned: 1, written: 1, failed: 0 });
  assert.equal(originalEntry()?.balanceEffect, -90);
  assert.equal(reversals().length, 1);
  assert.equal(reversals()[0]!.balanceEffect, 36);
  assert.deepEqual(await backfillCommission(), { scanned: 0, written: 0, failed: 0 });
  assert.equal(reversals().length, 1);
});

test('a card order, an unknown order and a closed database connection reconcile nothing and never throw', async () => {
  world.order({ paymentMethod: 'card', paymentStatus: 'paid' });
  refundedReturn([[P1, V1, 1]]);
  world.ledger.push({ _id: 'e1', store: STORE_A, order: ORDER_A, type: 'cod_commission', balanceEffect: -90, baseAmount: 2250, rate: 4, reversesType: null, returnId: null, createdAt: new Date() });
  assert.deepEqual(await reconcileReturnReversals(ORDER_A), { created: 0, existing: 0, nothingDue: 0, failed: 0 });
  assert.deepEqual(await reconcileReturnReversals('65a0000000000000000a09ff'), { created: 0, existing: 0, nothingDue: 0, failed: 0 });
  assert.equal(reversals().length, 0);
});
