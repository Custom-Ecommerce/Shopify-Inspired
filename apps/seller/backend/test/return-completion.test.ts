import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionOf, refundCapFor, refundCapOf } from '@/lib/returns';

// SB-6 (verification bug 6): the return that COMPLETES the received quantities of the whole order is the last one. Its refund cap is the order
// base (subtotal less discount) minus what the earlier returns took, so the caps of all the returns of an order add up to the order base exactly,
// however the discount share rounded in each part. Pure functions, no database.

const P1 = 'p1';
const P2 = 'p2';
const V1 = 'v1';
const V2 = 'v2';

/** The order of the verification run: P1 1000 x1 + P2 500 x2 = 2000, a discount of 150, so the commission base is 1850. */
const order = {
  _id: 'order-1',
  subtotal: 2000,
  discountAmount: 150,
  items: [
    { productId: P1, variantId: V1, productTitle: 'Kurta', variantTitle: 'Default', unitPrice: 1000, quantity: 1 },
    { productId: P2, variantId: V2, productTitle: 'Dupatta', variantTitle: 'Default', unitPrice: 500, quantity: 2 },
  ],
};

let clock = 0;
/** A return whose lines were all received, at a moment that grows with every call (receivedAt). */
function received(id: string, lines: Array<[string, string, number, number]>, status = 'received', receivedAt: Date | null = null): Record<string, unknown> {
  clock += 1000;
  return {
    _id: id,
    status,
    receivedAt: receivedAt ?? new Date(Date.UTC(2026, 10, 15, 10, 0, 0) + clock),
    items: lines.map(([productId, variantId, quantity, unitPrice]) => ({ productId, variantId, quantity, unitPrice })),
    received: lines.map(([productId, variantId, quantity]) => ({ productId, variantId, quantity, restock: true })),
  };
}
const kurta = (id: string, status?: string): Record<string, unknown> => received(id, [[P1, V1, 1, 1000]], status);
const dupatta = (id: string, status?: string): Record<string, unknown> => received(id, [[P2, V2, 1, 500]], status);

const caps = (all: Array<Record<string, unknown>>): Array<number | null> => all.map((doc) => refundCapFor(doc, order, all));
const sum = (values: Array<number | null>): number => values.reduce<number>((total, value) => total + (value ?? 0), 0);

test('the verification case: 2000 with a discount of 150 in three returns: 925 + 462 + 463 = 1850, the last takes the rounding rest', () => {
  const r1 = kurta('r1');
  const r2 = dupatta('r2');
  const r3 = dupatta('r3');
  const all = [r1, r2, r3];
  assert.deepEqual(caps(all), [925, 462, 463]);
  assert.equal(sum(caps(all)), 1850, 'the caps add up to the order base exactly (the old rule gave 1849)');
  assert.deepEqual([completionOf(r1, all, order).completes, completionOf(r2, all, order).completes, completionOf(r3, all, order).completes], [false, false, true]);
  assert.equal(completionOf(r3, all, order).earlierBase, 1387);
  assert.equal(refundCapOf(r3, order), 462, 'on its own the proportional cap is still 462: only the completion rule adds the rest');
});

test('returns that arrive in a different order: whichever is received last completes the order', () => {
  const r3 = dupatta('r3');
  const r2 = dupatta('r2');
  const r1 = kurta('r1'); // received last, although it may have been asked for first
  const all = [r1, r2, r3];
  assert.deepEqual(caps(all), [926, 462, 462], 'the kurta return completes: 1850 - 462 - 462');
  assert.equal(sum(caps(all)), 1850);
  assert.equal(completionOf(r1, all, order).completes, true);
  assert.equal(completionOf(r3, all, order).completes, false);
  // the list order of the siblings does not matter, receivedAt does
  assert.deepEqual(caps([r3, r1, r2]), [462, 926, 462]);
});

test('a single return of the whole order: its cap is the order base (price less the whole discount)', () => {
  const only = received('only', [[P1, V1, 1, 1000], [P2, V2, 2, 500]]);
  assert.equal(completionOf(only, [only], order).completes, true);
  assert.equal(completionOf(only, [only], order).earlierBase, 0);
  assert.equal(refundCapFor(only, order, [only]), 1850);
});

test('two partial returns that do not complete the order stay proportional', () => {
  const r1 = kurta('r1');
  const r2 = dupatta('r2');
  const all = [r1, r2];
  assert.deepEqual(caps(all), [925, 462]);
  assert.equal(completionOf(r1, all, order).completes, false);
  assert.equal(completionOf(r2, all, order).completes, false);
  assert.equal(sum(caps(all)), 1387, 'the Dupatta of the third unit is still with the shopper');
});

test('an order without a discount: split returns add up to the subtotal and the last one takes nothing extra', () => {
  const plain = { ...order, discountAmount: 0 };
  const r1 = kurta('r1');
  const r2 = received('r2', [[P2, V2, 2, 500]]);
  const all = [r1, r2];
  assert.deepEqual(all.map((doc) => refundCapFor(doc, plain, all)), [1000, 1000]);
});

test('only received and refunded returns count: a requested, approved or rejected sibling is ignored', () => {
  const r1 = kurta('r1', 'refunded');
  const rejected = dupatta('rej', 'rejected');
  const approved = dupatta('app', 'approved');
  delete approved.received; // an approved return has not been received: nothing came back yet
  const r2 = received('r2', [[P2, V2, 2, 500]]);
  const all = [r1, rejected, approved, r2];
  assert.equal(completionOf(r2, all, order).completes, true);
  assert.equal(refundCapFor(r2, order, all), 1850 - 925);
  assert.equal(completionOf(approved, all, order).completes, false, 'a return that was not received never completes');
  assert.equal(refundCapFor(approved, order, all), null, 'and has no cap yet');
});

test('a quantity that was not received (the shopper sent back less) means the order is not complete', () => {
  const r1 = received('r1', [[P1, V1, 1, 1000], [P2, V2, 1, 500]]);
  const r2 = received('r2', [[P2, V2, 1, 500]]);
  r2.items = [{ productId: P2, variantId: V2, quantity: 1, unitPrice: 500 }];
  r2.received = [{ productId: P2, variantId: V2, quantity: 0, restock: false }]; // asked for, nothing came back
  const all = [r1, r2];
  assert.equal(completionOf(r1, all, order).completes, false);
  assert.equal(completionOf(r2, all, order).completes, false);
});

test('returns from before SB-6 have no receivedAt: the last update, then the request, order them', () => {
  const a = { ...kurta('a'), receivedAt: undefined, updatedAt: new Date('2026-11-10T10:00:00Z') };
  const b = { ...received('b', [[P2, V2, 2, 500]]), receivedAt: undefined, updatedAt: new Date('2026-11-11T10:00:00Z') };
  const all = [b, a];
  assert.equal(completionOf(b, all, order).completes, true);
  assert.equal(completionOf(a, all, order).completes, false);
  assert.equal(sum(all.map((doc) => refundCapFor(doc, order, all))), 1850);
});

test('equal moments are ordered by id, so the rule gives one answer', () => {
  const at = new Date('2026-11-15T10:00:00Z');
  const x = received('a-first', [[P1, V1, 1, 1000]], 'received', at);
  const y = received('b-second', [[P2, V2, 2, 500]], 'received', at);
  assert.equal(completionOf(x, [y, x], order).completes, false);
  assert.equal(completionOf(y, [y, x], order).completes, true);
});
