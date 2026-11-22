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
  returnTaxShare,
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

test('commissionReversal: completesOrder keeps back the share of earlier returns without a reversal (SB-7)', () => {
  const base = { commission: 74, orderBase: 1850, returnedBase: 463, completesOrder: true, previousBase: 0, previousAmount: 0 };
  assert.equal(commissionReversal({ ...base, reservedForEarlier: 55 }), 19, 'refunded first: 74 - (37 + 18)');
  assert.equal(commissionReversal({ ...base, reservedForEarlier: 0, previousBase: 1387, previousAmount: 55 }), 19, 'refunded last: nothing held back');
  assert.equal(commissionReversal({ ...base, reservedForEarlier: 0 }), 74, 'a single full return');
  assert.equal(commissionReversal({ ...base, reservedForEarlier: 200 }), 0, 'never below zero');
});

// ------------------------------------------------------------------------------------------------- Sprint 8 (S8-B1): the tax share of a return

const taxOrder = (taxAmount: number, taxMode: string | null, orderBase: number) => ({ taxAmount, taxMode, orderBase });

test('returnTaxShare: an exclusive tax comes back in proportion to the base that comes back', () => {
  assert.equal(returnTaxShare({ ...taxOrder(510, 'exclusive', 3000), previousBase: 0, returnedBase: 1000 }), 170);
  assert.equal(returnTaxShare({ ...taxOrder(510, 'exclusive', 3000), previousBase: 0, returnedBase: 3000 }), 510, 'the whole base brings the whole tax');
  assert.equal(returnTaxShare({ ...taxOrder(510, 'exclusive', 3000), previousBase: 0, returnedBase: 0 }), 0);
});

test('returnTaxShare: an inclusive tax adds nothing (the returned base already contains it: no double counting)', () => {
  assert.equal(returnTaxShare({ ...taxOrder(436, 'inclusive', 3000), previousBase: 0, returnedBase: 1000 }), 0);
  assert.equal(returnTaxShare({ ...taxOrder(436, 'inclusive', 3000), previousBase: 0, returnedBase: 3000 }), 0);
});

test('returnTaxShare: no tax, an old order, a tax with no mode, and nothing taxable add nothing', () => {
  assert.equal(returnTaxShare({ ...taxOrder(0, 'exclusive', 3000), previousBase: 0, returnedBase: 1000 }), 0);
  assert.equal(returnTaxShare({ taxAmount: undefined, taxMode: undefined, orderBase: 3000, previousBase: 0, returnedBase: 1000 }), 0);
  assert.equal(returnTaxShare({ ...taxOrder(510, null, 3000), previousBase: 0, returnedBase: 1000 }), 0);
  assert.equal(returnTaxShare({ ...taxOrder(510, 'exclusive', 0), previousBase: 0, returnedBase: 1000 }), 0);
  assert.equal(returnTaxShare({ ...taxOrder(-5, 'exclusive', 3000), previousBase: 0, returnedBase: 1000 }), 0);
});

test('returnTaxShare: three partial returns add up to exactly the tax paid and to exactly the order total (no rupee lost or created)', () => {
  // Items 333 + 333 + 334 = 1000, tax 17.5% = 175, no delivery: the order total is 1175.
  const order = taxOrder(175, 'exclusive', 1000);
  const bases = [333, 333, 334];
  let previous = 0;
  const caps: number[] = [];
  const shares: number[] = [];
  for (const base of bases) {
    const share = returnTaxShare({ ...order, previousBase: previous, returnedBase: base });
    shares.push(share);
    caps.push(base + share);
    previous += base;
  }
  assert.deepEqual(shares, [58, 59, 58], 'a rounding per return would give 58 + 58 + 58 = 174: the last one takes the remainder');
  assert.equal(shares.reduce((sum, value) => sum + value, 0), 175);
  assert.deepEqual(caps, [391, 392, 392]);
  assert.equal(caps.reduce((sum, value) => sum + value, 0), 1175, 'the caps add up to the order total');
});

test('returnTaxShare: three partial returns of an order with a discount add up exactly (the completing return takes the base that is left)', () => {
  // Items 2 x 500 + 400 + 600 = 2000, discount 150: base 1850; tax 17% on 1850 = 315 (314.5 rounds up). Order total (no delivery) 2165.
  const order = taxOrder(315, 'exclusive', 1850);
  const first = returnedBase([{ unitPrice: 500, quantity: 1 }], { subtotal: 2000, discountAmount: 150 });
  const second = returnedBase([{ unitPrice: 500, quantity: 1 }], { subtotal: 2000, discountAmount: 150 });
  assert.equal(first, 462);
  const third = 1850 - first - second; // the completing return: the order base minus what the earlier ones took
  assert.equal(third, 926);
  const s1 = returnTaxShare({ ...order, previousBase: 0, returnedBase: first });
  const s2 = returnTaxShare({ ...order, previousBase: first, returnedBase: second });
  const s3 = returnTaxShare({ ...order, previousBase: first + second, returnedBase: third });
  assert.deepEqual([s1, s2, s3], [79, 78, 158]);
  assert.equal(s1 + s2 + s3, 315);
  assert.equal(first + s1 + second + s2 + third + s3, 2165);
});

test('returnTaxShare: however an order is split, the shares are never negative and add up to the tax (a sweep)', () => {
  const splits = [[1], [1, 1, 1], [7, 13, 80], [999, 1], [1, 999], [250, 250, 250, 250], [333, 333, 334], [1, 2, 3, 4, 990]];
  for (const [tax, base] of [[175, 1000], [315, 1850], [1, 3], [17, 100], [3, 9], [12345, 987654]] as const) {
    for (const split of splits) {
      const total = split.reduce((sum, part) => sum + part, 0);
      // Scale the split onto this order's base; the last part takes what is left of the base.
      let previous = 0;
      let sum = 0;
      split.forEach((part, index) => {
        const returned = index === split.length - 1 ? base - previous : Math.round((part * base) / total);
        const share = returnTaxShare({ taxAmount: tax, taxMode: 'exclusive', orderBase: base, previousBase: previous, returnedBase: Math.max(0, returned) });
        assert.ok(share >= 0, 'share of part ' + index + ' of ' + JSON.stringify(split) + ' on ' + tax + '/' + base);
        sum += share;
        previous += Math.max(0, returned);
      });
      assert.equal(sum, tax, JSON.stringify(split) + ' on tax ' + tax + ' base ' + base);
    }
  }
});

test('returnTaxShare: more than the order base is clipped to the tax paid, and a later return of nothing adds nothing', () => {
  assert.equal(returnTaxShare({ ...taxOrder(510, 'exclusive', 3000), previousBase: 0, returnedBase: 9000 }), 510);
  assert.equal(returnTaxShare({ ...taxOrder(510, 'exclusive', 3000), previousBase: 3000, returnedBase: 500 }), 0, 'the whole tax was already given back');
  assert.equal(returnTaxShare({ ...taxOrder(510, 'exclusive', 3000), previousBase: 1000, returnedBase: 0 }), 0);
});

test('the commission reversal never reads the tax: its inputs are the tax-free bases (D-089)', () => {
  // The same order with and without tax gives the same reversal: commission and bases do not carry the tax share.
  const base = { commission: 74, orderBase: 1850, previousBase: 0, previousAmount: 0, returnedBase: 925 };
  const reversal = commissionReversal(base);
  assert.equal(reversal, 37);
  const tax = returnTaxShare({ ...taxOrder(315, 'exclusive', 1850), previousBase: 0, returnedBase: 925 });
  assert.equal(tax, 158);
  assert.equal(commissionReversal(base), reversal, 'adding a tax share to the refund cap does not move the reversal');
});
