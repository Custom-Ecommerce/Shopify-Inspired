import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commissionReversal,
  discountShare,
  everythingReceived,
  grossOf,
  refundRoom,
  returnWindow,
  returnableQuantities,
  returnedBase,
} from '../src/return-money';

// Sprint 5 EP-13 (D-107, D-108): the arithmetic of returns. Whole rupees, integer arithmetic, no float carried between steps.

const line = (productId: string, variantId: string, quantity: number) => ({ productId, variantId, quantity });

// ------------------------------------------------------------------------------------------------------- the returned base

test('the gross of lines is price times quantity, summed', () => {
  assert.equal(grossOf([{ unitPrice: 1500, quantity: 2 }, { unitPrice: 400, quantity: 1 }]), 3400);
  assert.equal(grossOf([]), 0);
});

test('the discount share is round(discount x gross / subtotal), and the whole discount for the whole order', () => {
  assert.equal(discountShare(500, 2000, 2000), 500, 'returning everything gives the whole discount back');
  assert.equal(discountShare(500, 2000, 500), 125);
  assert.equal(discountShare(100, 300, 100), 33, '33.33 rounds to 33');
  assert.equal(discountShare(100, 300, 200), 67, '66.67 rounds to 67');
  assert.equal(discountShare(0, 2000, 500), 0, 'no discount, no share');
  assert.equal(discountShare(500, 0, 500), 0, 'an order with no subtotal has no share');
  assert.equal(discountShare(500, 2000, 99999), 500, 'a gross over the subtotal never gives more than the discount');
});

test('the returned base: the price of the returned quantities less their discount share, delivery excluded', () => {
  // 2 x 1000 + 1 x 500 = 2500, discount 250. Returning one of the 1000s: gross 1000, share 100, base 900.
  const order = { subtotal: 2500, discountAmount: 250 };
  assert.equal(returnedBase([{ unitPrice: 1000, quantity: 1 }], order), 900);
  assert.equal(returnedBase([{ unitPrice: 1000, quantity: 2 }, { unitPrice: 500, quantity: 1 }], order), 2250, 'everything back: the order base');
  assert.equal(returnedBase([{ unitPrice: 1000, quantity: 1 }], { subtotal: 2500, discountAmount: 0 }), 1000, 'no discount');
  assert.equal(returnedBase([], order), 0);
});

test('the parts of a return in pieces add up to no more than the order base (rounding cannot invent rupees)', () => {
  const order = { subtotal: 300, discountAmount: 100 };
  const parts = [1, 2, 3].map((n) => returnedBase([{ unitPrice: 100, quantity: 1 }], order));
  assert.equal(parts.every((part) => part === 67), true, 'each of the three: 100 less a 33 share');
  // The three together are 201 against a base of 200: this is why the commission reversal takes the REMAINDER for the last one.
  assert.equal(returnedBase([{ unitPrice: 100, quantity: 3 }], order), 200);
});

// ------------------------------------------------------------------------------------------------------ the commission reversal

const reversal = (over: Partial<Parameters<typeof commissionReversal>[0]> = {}) =>
  commissionReversal({ commission: 80, orderBase: 2000, returnedBase: 500, previousBase: 0, previousAmount: 0, ...over });

test('a reversal is proportional and rounded to the rupee', () => {
  assert.equal(reversal(), 20);
  assert.equal(reversal({ returnedBase: 333 }), 13, '80 x 333 / 2000 = 13.32');
  assert.equal(reversal({ returnedBase: 625 }), 25);
  assert.equal(reversal({ commission: 45, orderBase: 1000, returnedBase: 333 }), 15, '14.985 rounds to 15');
  assert.equal(reversal({ commission: 45, orderBase: 1000, returnedBase: 1 }), 0, '0.045 rounds to 0');
});

test('a return of everything reverses the whole commission, whatever the rounding', () => {
  assert.equal(reversal({ returnedBase: 2000 }), 80);
  assert.equal(reversal({ commission: 47, orderBase: 1175, returnedBase: 1175 }), 47);
});

test('the last return takes the remainder, so the parts add up to exactly the original', () => {
  // 45 over a base of 1000 in three returns.
  const first = reversal({ commission: 45, orderBase: 1000, returnedBase: 333 });
  const second = reversal({ commission: 45, orderBase: 1000, returnedBase: 333, previousBase: 333, previousAmount: first });
  const third = reversal({ commission: 45, orderBase: 1000, returnedBase: 334, previousBase: 666, previousAmount: first + second });
  assert.deepEqual([first, second, third], [15, 15, 15]);
  assert.equal(first + second + third, 45);
  // 10 over a base of 3 in three returns of 1: 3, 3 and the remainder 4.
  const a = reversal({ commission: 10, orderBase: 3, returnedBase: 1 });
  const b = reversal({ commission: 10, orderBase: 3, returnedBase: 1, previousBase: 1, previousAmount: a });
  const c = reversal({ commission: 10, orderBase: 3, returnedBase: 1, previousBase: 2, previousAmount: a + b });
  assert.deepEqual([a, b, c], [3, 3, 4]);
});

test('a second partial return counts what the first already gave back', () => {
  assert.equal(reversal({ returnedBase: 600, previousBase: 500, previousAmount: 20 }), 24);
});

test('the reversals of an order never add up to more than the original commission', () => {
  // A return whose share would overshoot is cut to what is left.
  assert.equal(reversal({ returnedBase: 1000, previousBase: 500, previousAmount: 70 }), 10, 'only 10 of the 80 is left');
  assert.equal(reversal({ returnedBase: 500, previousBase: 2000, previousAmount: 80 }), 0, 'everything was already given back');
  assert.equal(reversal({ returnedBase: 500, previousBase: 0, previousAmount: 80 }), 0, 'a full cancel reversal was written: nothing is left');
  assert.equal(reversal({ returnedBase: 9999 }), 80, 'a base over the order base is cut to the order base');
});

test('nothing to reverse: no commission, no base, nothing returned', () => {
  assert.equal(reversal({ commission: 0 }), 0);
  assert.equal(reversal({ orderBase: 0 }), 0);
  assert.equal(reversal({ returnedBase: 0 }), 0);
  assert.equal(reversal({ commission: -5 }), 0);
  assert.equal(reversal({ returnedBase: Number.NaN }), 0);
});

test('an order with a discount reverses on its own base: returned base 375 of a base of 1500 gives back a quarter of 60', () => {
  const order = { subtotal: 2000, discountAmount: 500 };
  // One quarter of the items (gross 500) is returned: share round(500 x 500 / 2000) = 125, base 375.
  const base = returnedBase([{ unitPrice: 500, quantity: 1 }], order);
  assert.equal(base, 375);
  assert.equal(commissionReversal({ commission: 60, orderBase: 1500, returnedBase: base, previousBase: 0, previousAmount: 0 }), 15);
});

// --------------------------------------------------------------------------------------------------------- the window and caps

const DELIVERED = new Date('2026-11-10T10:00:00Z');
const days = (n: number, extraMs = 0) => new Date(DELIVERED.getTime() + n * 86_400_000 + extraMs);

test('the window opens at the delivered date and runs windowDays days; the last moment is still inside', () => {
  assert.equal(returnWindow(DELIVERED, 7, DELIVERED).state, 'open');
  assert.equal(returnWindow(DELIVERED, 7, days(6)).state, 'open');
  assert.equal(returnWindow(DELIVERED, 7, days(7)).state, 'open', 'exactly seven days after is the last moment');
  assert.equal(returnWindow(DELIVERED, 7, days(7, 1)).state, 'closed');
  assert.equal(returnWindow(DELIVERED, 7, days(30)).state, 'closed');
  assert.equal(returnWindow(DELIVERED, 7, DELIVERED).endsAt?.toISOString(), '2026-11-17T10:00:00.000Z');
});

test('0 days means the store takes no returns; an order never delivered has no window', () => {
  assert.equal(returnWindow(DELIVERED, 0, DELIVERED).state, 'returns_off');
  assert.equal(returnWindow(null, 7, DELIVERED).state, 'not_delivered');
  assert.equal(returnWindow(new Date('nope'), 7, DELIVERED).state, 'not_delivered');
  assert.equal(returnWindow(null, 0, DELIVERED).state, 'returns_off', 'returns off wins');
  assert.equal(returnWindow(DELIVERED, 30, days(30)).state, 'open');
});

test('returnable quantities: delivered minus what earlier returns ask for, per productId and variantId, never below 0', () => {
  const delivered = [line('P1', 'V1', 3), line('P1', 'V2', 1), line('P2', 'V9', 2)];
  const left = returnableQuantities(delivered, [line('P1', 'V1', 2), line('p1', 'v1', 1), line('P2', 'V9', 5)]);
  assert.equal(left.get('p1|v1'), 0, 'both earlier returns count, in any letter case');
  assert.equal(left.get('p1|v2'), 1, 'another variant of the same product is its own line');
  assert.equal(left.get('p2|v9'), 0, 'never below zero');
  assert.deepEqual([...returnableQuantities(delivered, [])].map(([, quantity]) => quantity), [3, 1, 2]);
});

test('the order is "everything received" only when every delivered quantity is back across its returns', () => {
  const delivered = [line('P1', 'V1', 2), line('P2', 'V2', 1)];
  assert.equal(everythingReceived(delivered, [line('P1', 'V1', 2)]), false, 'one line is missing');
  assert.equal(everythingReceived(delivered, [line('P1', 'V1', 1), line('P2', 'V2', 1)]), false, 'a quantity is short');
  assert.equal(everythingReceived(delivered, [line('P1', 'V1', 1), line('P2', 'V2', 1), line('P1', 'V1', 1)]), true, 'two returns add up');
  assert.equal(everythingReceived(delivered, [line('P1', 'V1', 5), line('P2', 'V2', 1)]), true);
  assert.equal(everythingReceived([], []), false, 'an order with no lines is never "all back"');
});

test('what is left to refund is the cap less what is recorded, never below 0', () => {
  assert.equal(refundRoom(900, 400), 500);
  assert.equal(refundRoom(900, 900), 0);
  assert.equal(refundRoom(900, 1200), 0);
  assert.equal(refundRoom(0, 0), 0);
});

// SB-6 (verification bug 6): the return that completes the received quantities of the order takes everything that is left of the commission.
test('commissionReversal: completesOrder takes what is left, whatever the earlier parts rounded to', () => {
  // 2000 with a discount of 150: commission 74, three returns of 925 + 462 + 463; the first two took 37 and 18
  const base = { commission: 74, orderBase: 1850, previousBase: 1387, previousAmount: 55 };
  assert.equal(commissionReversal({ ...base, returnedBase: 463 }), 19, 'previous base 1387 + 463 = 1850 reaches the base: the old rule already took the rest here');
  assert.equal(commissionReversal({ ...base, returnedBase: 462 }), 18, 'one rupee short of the base (rounded shares): proportional, not the rest');
  assert.equal(commissionReversal({ ...base, returnedBase: 462, completesOrder: true }), 19, 'completesOrder: the rest, so 37 + 18 + 19 = 74');
  assert.equal(commissionReversal({ ...base, returnedBase: 0, completesOrder: true }), 19);
  assert.equal(commissionReversal({ commission: 74, orderBase: 1850, previousBase: 0, previousAmount: 0, returnedBase: 1850, completesOrder: true }), 74, 'a single full return');
  assert.equal(commissionReversal({ ...base, previousAmount: 74, returnedBase: 462, completesOrder: true }), 0, 'never more than the original');
  assert.equal(commissionReversal({ commission: 0, orderBase: 1850, previousBase: 0, previousAmount: 0, returnedBase: 500, completesOrder: true }), 0, 'no commission, nothing to give back');
});
