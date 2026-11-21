import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CommissionEntry } from '@/lib/services';
import { reverseForReturn, reverseLedgerForOrder } from '@/lib/commission';
import { buildEarnings } from '@/lib/earnings';
import { commissionTotals, returnsTotals, unsettledBalance } from '@/lib/ledger-aggregates';
import * as dbNs from '@markaz/db-schemas';
import { unwrapCjs } from '@/lib/cjs';
import { installLedgerWorld, matchRow, ORDER_1, ORDER_2, STORE_A, type Row, type World } from './helpers/ledger-world';

// Sprint 5 EP-13.US03.T02, T03, T04 (D-107, audit R1 and R2): the proportional commission reversal of a return, written once per return, the
// second partial return that no longer hits a duplicate key, the remainder, the append-only guard, and the seller's earnings counting it.
// The ledger is in memory (ledger-world) with a create that emulates the unique index { order, type, reversesType, returnId }.

const { assertSettlementOnlyUpdate } = unwrapCjs(dbNs) as typeof dbNs;
const EntryModel = CommissionEntry as any;
const RETURN_1 = '65a0000000000000000e0001';
const RETURN_2 = '65a0000000000000000e0002';
const RETURN_3 = '65a0000000000000000e0003';
const NOW = new Date('2026-11-15T10:00:00Z');
const at = (iso: string) => new Date(iso);

let world: World;
let undo: Array<() => void> = [];

const isDuplicate = (doc: Row) =>
  world.entries.some(
    (e) =>
      String(e.order) === String(doc.order) &&
      e.type === doc.type &&
      String(e.reversesType ?? null) === String(doc.reversesType ?? null) &&
      String(e.returnId ?? null) === String(doc.returnId ?? null),
  );

beforeEach(() => {
  world = installLedgerWorld();
  undo = [];
  const create = EntryModel.create;
  const findOne = EntryModel.findOne;
  EntryModel.create = async (doc: Row) => {
    await Promise.resolve();
    if (isDuplicate(doc)) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const row = world.entry({ ...doc });
    return { ...row };
  };
  EntryModel.findOne = (filter: Row) => ({ lean: async () => (world.entries.find((row) => matchRow(row, filter)) ? { ...world.entries.find((row) => matchRow(row, filter)) } : null) });
  undo.push(() => {
    EntryModel.create = create;
    EntryModel.findOne = findOne;
  });
});

afterEach(() => {
  for (const restore of undo.reverse()) restore();
  world.restore();
});

/** An order with a cash on delivery commission already written: 4% of a base of `base`. */
function commissionOf(base: number, rate = 4, commission = Math.round((base * rate) / 100)): Row {
  return world.entry({ type: 'cod_commission', order: ORDER_1, balanceEffect: -commission, baseAmount: base, rate, createdAt: at('2026-11-10T08:00:00Z') });
}
const order = { _id: ORDER_1, store: STORE_A, orderId: 'ORD-AAAA1111', paymentMethod: 'cod' };
const returnReversals = () => world.entries.filter((e) => e.type === 'reversal' && e.returnId !== undefined && e.returnId !== null);
const given = () => returnReversals().reduce((sum, e) => sum + e.balanceEffect, 0);

// ------------------------------------------------------------------------------------------------------------- proportional

test('a return writes ONE reversal: the opposite sign, in whole rupees, = round(commission x returned base / order base)', async () => {
  commissionOf(2000); // commission 80
  const result = await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 });
  assert.deepEqual(result, { outcome: 'created', amount: 20 });
  assert.equal(returnReversals().length, 1);
  const entry = returnReversals()[0]!;
  assert.equal(entry.type, 'reversal');
  assert.equal(entry.reversesType, 'cod_commission');
  assert.equal(entry.balanceEffect, 20, 'the original is -80, so the reversal is positive');
  assert.equal(entry.baseAmount, 500);
  assert.equal(entry.rate, 4);
  assert.equal(String(entry.returnId), RETURN_1);
  assert.equal(Number.isInteger(entry.balanceEffect), true);
  assert.equal(world.audits.filter((a) => a.action === 'commission.reversal').length, 1);
  assert.deepEqual(Object.keys(world.audits[0]!.details).sort(), ['amount', 'at', 'returnId']);
});

test('a repeat call for the same return writes nothing (the unique index decides a race)', async () => {
  commissionOf(2000);
  await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 });
  const again = await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 });
  assert.deepEqual(again, { outcome: 'exists' });
  assert.equal(returnReversals().length, 1);
  // Two calls racing: both read before either writes, one entry is left.
  world.entries.length = 0;
  commissionOf(2000);
  const results = await Promise.all([reverseForReturn({ returnId: RETURN_2, order, returnedBase: 500 }), reverseForReturn({ returnId: RETURN_2, order, returnedBase: 500 })]);
  assert.equal(returnReversals().length, 1);
  assert.deepEqual(results.map((r) => r.outcome).sort(), ['created', 'exists']);
});

test('a SECOND partial return of the same order does not hit a duplicate key: the old key allowed one reversal per order', async () => {
  commissionOf(2000);
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 }), { outcome: 'created', amount: 20 });
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 600 }), { outcome: 'created', amount: 24 });
  assert.equal(returnReversals().length, 2);
  assert.equal(given(), 44);
  // The emulated index is the new one: the same return twice is a duplicate, two returns are not.
  assert.equal(isDuplicate({ order: ORDER_1, type: 'reversal', reversesType: 'cod_commission', returnId: RETURN_1 }), true);
  assert.equal(isDuplicate({ order: ORDER_1, type: 'reversal', reversesType: 'cod_commission', returnId: RETURN_3 }), false);
});

test('the last return takes the remainder, so the parts add up to exactly the original (45 in three returns of 333, 333 and 334)', async () => {
  commissionOf(1000, 4.5, 45);
  const first = await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 333 });
  const second = await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 333 });
  const third = await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 334 });
  assert.deepEqual([first, second, third], [
    { outcome: 'created', amount: 15 },
    { outcome: 'created', amount: 15 },
    { outcome: 'created', amount: 15 },
  ]);
  assert.equal(given(), 45);
});

test('the remainder is what is left, not a rounded share: 10 of base 3 returned one by one gives 3, 3 and 4', async () => {
  commissionOf(3, 4, 10);
  const amounts: number[] = [];
  for (const returnId of [RETURN_1, RETURN_2, RETURN_3]) {
    const result = await reverseForReturn({ returnId, order, returnedBase: 1 });
    amounts.push(result.outcome === 'created' ? result.amount : -1);
  }
  assert.deepEqual(amounts, [3, 3, 4]);
  assert.equal(given(), 10);
});

test('a return of everything reverses the whole commission', async () => {
  commissionOf(2000);
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 2000 }), { outcome: 'created', amount: 80 });
  assert.equal(given(), 80);
});

test('the reversals of an order never add up to more than the original commission', async () => {
  commissionOf(2000);
  await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 2000 });
  // Everything is already given back: a later return finds nothing left.
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 500 }), { outcome: 'nothing' });
  assert.equal(given(), 80);
  // A return claiming more than the order base is cut to what is left of it.
  world.entries.length = 0;
  commissionOf(2000);
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 5000 }), { outcome: 'created', amount: 80 });
});

test('a full reversal of the cancel path (no returnId) counts: a return after it finds nothing to give back', async () => {
  commissionOf(2000);
  assert.deepEqual(await reverseLedgerForOrder(ORDER_1, 'cancelled'), { written: 1, existing: 0, failed: 0 });
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 }), { outcome: 'nothing' });
  assert.equal(returnReversals().length, 0);
});

test('an order with no commission entry (not delivered and collected, or a card order) has nothing to reverse', async () => {
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 }), { outcome: 'no_commission' });
  world.entry({ type: 'card_sale', order: ORDER_2, balanceEffect: 2250, baseAmount: 2250 });
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order: { ...order, _id: ORDER_2 }, returnedBase: 500 }), { outcome: 'no_commission' });
});

test('a base that rounds to nothing writes nothing, and an order with a discount reverses on its own base', async () => {
  commissionOf(1500, 4, 60); // subtotal 2000, discount 500: the base is 1500
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 0 }), { outcome: 'nothing' });
  // A returned base of 375 (a quarter of the order) gives back a quarter of 60.
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 375 }), { outcome: 'created', amount: 15 });
});

test('the original entry and the other entries are left as they were (settled or not)', async () => {
  const original = commissionOf(2000);
  original.settledAt = at('2026-11-12T00:00:00Z');
  await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 });
  assert.equal(original.balanceEffect, -80);
  assert.equal(original.settledAt.toISOString(), '2026-11-12T00:00:00.000Z');
});

test('a ledger that is not ready, or a write that fails, never throws and says so', async () => {
  commissionOf(2000);
  const original = EntryModel.create;
  EntryModel.create = async () => {
    throw new Error('write failed: mongodb://user:password@host/db');
  };
  const logged: string[] = [];
  const spy = console.error;
  console.error = (...args: unknown[]) => logged.push(JSON.stringify(args));
  try {
    assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 }), { outcome: 'failed' });
  } finally {
    console.error = spy;
    EntryModel.create = original;
  }
  assert.equal(logged.join('').includes('password'), false, 'the connection string is never logged');
});

// ------------------------------------------------------------------------------------------------------------------- guards

test('the model keeps its append-only guard: a returnId never changes after the write, only the settlement fields do', () => {
  assert.doesNotThrow(() => assertSettlementOnlyUpdate({ $set: { settledAt: new Date(), payoutId: '65a0000000000000000b0001' } }));
  for (const update of [{ $set: { returnId: RETURN_1 } }, { $set: { balanceEffect: 1 } }, { $unset: { returnId: 1 } }, { returnId: RETURN_1 }, { $inc: { baseAmount: 1 } }]) {
    assert.throws(() => assertSettlementOnlyUpdate(update), /append only/, JSON.stringify(update));
  }
});

test('the ledger model has returnId (optional) and a unique index over order, type, reversesType and returnId', () => {
  const schema = EntryModel.schema;
  assert.ok(schema.path('returnId'), 'declared, so strict mode keeps it');
  const unique = schema.indexes().find(([, options]: any[]) => options?.unique);
  assert.deepEqual(unique[0], { order: 1, type: 1, reversesType: 1, returnId: 1 });
  assert.equal(unique[1].name, 'order_type_reverses_return_unique');
  // An entry with no returnId (every entry written before Sprint 5) is still valid.
  const old = new EntryModel({ store: STORE_A, order: ORDER_1, type: 'cod_commission', balanceEffect: -80, baseAmount: 2000, rate: 4 });
  assert.equal(old.validateSync(), undefined);
  assert.equal(old.returnId, null);
});

// ------------------------------------------------------------------------------------------------------------------ earnings

function ledgerWithReturn() {
  commissionOf(2000);
  world.entry({ type: 'reversal', reversesType: 'cod_commission', order: ORDER_1, balanceEffect: 20, baseAmount: 500, returnId: RETURN_1, createdAt: at('2026-11-12T08:00:00Z') });
  world.entry({ type: 'reversal', reversesType: 'cod_commission', order: ORDER_1, balanceEffect: 24, baseAmount: 600, returnId: RETURN_2, createdAt: at('2026-11-13T08:00:00Z') });
}

test('earnings count the reversals: the summary equals the ledger sum, and the Returns line says how much of it was returns', async () => {
  ledgerWithReturn();
  const result = await buildEarnings(STORE_A, { period: '30', page: 1, limit: 20 } as never, NOW);
  const rows = world.entries.filter((e) => e.store === STORE_A);
  const sales = rows.reduce((sum, e) => sum + (e.type === 'reversal' ? -e.baseAmount : e.baseAmount), 0);
  const commission = -rows.reduce((sum, e) => sum + e.balanceEffect, 0);
  assert.deepEqual(result.summary, { sales, commission, net: sales - commission });
  assert.deepEqual(result.summary, { sales: 900, commission: 36, net: 864 });
  assert.deepEqual(result.returns, { count: 2, sales: 1100, commission: 44 });
  assert.equal(result.entries.totalDocs, 3, 'the ledger list shows the return reversals');
});

test("the reversal of a cancelled order (no returnId) is netted into the summary but is not a 'return' line", async () => {
  commissionOf(2000);
  await reverseLedgerForOrder(ORDER_1, 'cancelled');
  const result = await buildEarnings(STORE_A, { period: '30', page: 1, limit: 20 } as never, NOW);
  assert.deepEqual(result.summary, { sales: 0, commission: 0, net: 0 });
  assert.deepEqual(result.returns, { count: 0, sales: 0, commission: 0 });
});

test('a partial return takes the commission back but the order stays in the count; the balance reflects the reversal', async () => {
  commissionOf(2000);
  world.entry({ type: 'reversal', reversesType: 'cod_commission', order: ORDER_1, balanceEffect: 20, baseAmount: 500, returnId: RETURN_1, createdAt: at('2026-11-12T08:00:00Z') });
  const start = at('2026-10-01T00:00:00Z');
  const end = at('2026-12-01T00:00:00Z');
  const totals = await commissionTotals(STORE_A, start, end);
  const returns = await returnsTotals(STORE_A, start, end);
  assert.deepEqual(returns, { count: 1, commission: 20, sales: 500 });
  assert.equal(totals.commission, 60);
  // SB-6 (verification bug 7): commissionTotals itself leaves a return's reversal out of the order count (the old rule counted originals minus
  // every reversal, clamped at 0, and the report then added returns.count back, which overcounted once reversals outnumbered orders).
  assert.equal(totals.orders, 1, 'a partial return must not take the order off the count');
  assert.equal(await unsettledBalance(STORE_A), -60, 'what the seller owes the platform is lower by the commission given back');
});

// ------------------------------------------------------------------------------------------------- SB-6: the return that completes the order

test('SB-6 (bug 6): a full return made of three parts reverses the WHOLE commission: 37 + 18 + 19 = 74 (the old rule gave 73)', async () => {
  commissionOf(1850); // 2000 less a discount of 150, commission 74
  const first = await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 925 });
  const second = await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 462 });
  const third = await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 463, completesOrder: true });
  assert.deepEqual([first, second, third], [{ outcome: 'created', amount: 37 }, { outcome: 'created', amount: 18 }, { outcome: 'created', amount: 19 }]);
  assert.equal(given(), 74, 'the reversals add up to the original commission exactly');
  assert.deepEqual(returnReversals().map((e) => e.baseAmount), [925, 462, 463], 'the bases add up to the order base 1850');
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 463, completesOrder: true }), { outcome: 'exists' }, 'a repeat finds the entry and writes nothing');
  assert.equal(given(), 74);
});

// SB-7 (re-verification bug 2): the completing return keeps back the proportional share of the earlier received returns that have no reversal yet.
// Order 2000, discount 150: base 1850, commission 74, returns 925 (kurta) / 462 / 463 (the one that completes). Shares: 37, 18; the completing one: 74 - 55 = 19.
const EARLIER = [{ returnId: RETURN_1, base: 925 }, { returnId: RETURN_2, base: 462 }];

test('SB-7: the completing return refunded FIRST takes 19 (not 74); the earlier ones refunded later still get 37 and 18', async () => {
  commissionOf(1850);
  const completing = await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 463, completesOrder: true, earlierReturns: EARLIER });
  assert.deepEqual(completing, { outcome: 'created', amount: 19 });
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 925 }), { outcome: 'created', amount: 37 });
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 462 }), { outcome: 'created', amount: 18 });
  assert.equal(given(), 74, 'exactly the commission, whatever the refund order');
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 463, completesOrder: true, earlierReturns: EARLIER }), { outcome: 'exists' });
  assert.equal(given(), 74);
});

test('SB-7: refunded last: 37 / 18 / 19 (the earlier ones already have their reversal, nothing is held back)', async () => {
  commissionOf(1850);
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 925 }), { outcome: 'created', amount: 37 });
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 462 }), { outcome: 'created', amount: 18 });
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 463, completesOrder: true, earlierReturns: EARLIER }), { outcome: 'created', amount: 19 });
  assert.equal(given(), 74);
});

test('SB-7: refunded in the middle (kurta, then the completing one, then the last earlier one): 37, 19, 18', async () => {
  commissionOf(1850);
  assert.equal((await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 925 })).outcome, 'created');
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 463, completesOrder: true, earlierReturns: EARLIER }), { outcome: 'created', amount: 19 }, 'holds back only the share of the one still without a reversal (18)');
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 462 }), { outcome: 'created', amount: 18 });
  assert.equal(given(), 74);
});

test('SB-7: only the completing return is ever refunded: 19 of 74, not the whole commission', async () => {
  commissionOf(1850);
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_3, order, returnedBase: 463, completesOrder: true, earlierReturns: EARLIER }), { outcome: 'created', amount: 19 });
  assert.equal(given(), 19);
});

test('SB-7: a single full return still takes the whole commission (no earlier returns to keep back)', async () => {
  commissionOf(1850);
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 1850, completesOrder: true, earlierReturns: [] }), { outcome: 'created', amount: 74 });
});

test('SB-6: a partial return stays proportional (no completesOrder, no remainder)', async () => {
  commissionOf(1850);
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 925, completesOrder: false }), { outcome: 'created', amount: 37 });
  assert.equal(given(), 37);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-12.US04.T02 (D-116): a COD order at 0 percent has a zero entry; a return of it gives back nothing, without an error.

test('Sprint 6: a return of an order whose COD entry is zero (0 percent) gives nothing due, without an error and without a row', async () => {
  commissionOf(2000, 0); // rate 0: balanceEffect 0
  const result = await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 });
  assert.deepEqual(result, { outcome: 'nothing' });
  assert.equal(returnReversals().length, 0);
  assert.equal(world.audits.filter((a) => a.action === 'commission.reversal').length, 0);
});

test('Sprint 6: the return that completes the order of a zero entry also gives nothing due', async () => {
  commissionOf(2000, 0);
  const result = await reverseForReturn({ returnId: RETURN_2, order, returnedBase: 2000, completesOrder: true });
  assert.deepEqual(result, { outcome: 'nothing' });
  assert.equal(returnReversals().length, 0);
});

test('Sprint 6: an order without any COD entry still answers no_commission (nothing to give back), not nothing', async () => {
  assert.deepEqual(await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 }), { outcome: 'no_commission' });
});

test('Sprint 6: the reversal follows the ORIGINAL entry (rate and amount), not the percent that applies now', async () => {
  commissionOf(2000, 4); // written at 4 percent: 80
  // the COD percent is 0 by now; reverseForReturn never reads it
  const result = await reverseForReturn({ returnId: RETURN_1, order, returnedBase: 500 });
  assert.deepEqual(result, { outcome: 'created', amount: 20 });
  assert.equal(returnReversals()[0]!.rate, 4);
});

test('Sprint 6: reverseLedgerForOrder with a zero COD entry writes a zero reversal and reports no failure', async () => {
  commissionOf(2000, 0);
  assert.deepEqual(await reverseLedgerForOrder(ORDER_1, 'cancelled'), { written: 1, existing: 0, failed: 0 });
  const reversal = world.entries.find((e) => e.type === 'reversal')!;
  assert.equal(reversal.balanceEffect === 0, true);
  assert.equal(reversal.reversesType, 'cod_commission');
});
