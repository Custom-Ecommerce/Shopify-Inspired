import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOCK_WARNING_THRESHOLD } from '@/lib/contracts';
import { applyStockLevel, stockAlertRelevant, type StockAlertModel } from '@/lib/stock-alerts';

// EP-07.US03.T02: low-stock and out-of-stock alerts. A fake model that enforces the partial unique index of
// models/seller-alert.ts: one OPEN alert per store and dedupeKey.

const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const PRODUCT = '65a000000000000000000021';
const VARIANT = '65A0000000000000000000V1'.toLowerCase();

function fakeAlerts() {
  const rows: Array<Record<string, any>> = [];
  let next = 1;
  const model: StockAlertModel = {
    async create(doc) {
      if (rows.some((r) => r.open && r.store === doc.store && r.dedupeKey === doc.dedupeKey)) {
        throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
      }
      const row = { _id: 'alert' + next++, ...doc };
      rows.push(row);
      return row;
    },
    async updateMany(filter, update) {
      const kinds = (filter.kind as { $in: string[] }).$in;
      const hit = rows.filter((r) => r.store === filter.store && r.variantId === filter.variantId && r.open === filter.open && kinds.includes(r.kind));
      for (const row of hit) Object.assign(row, (update as { $set: Record<string, unknown> }).$set);
      return { modifiedCount: hit.length };
    },
  };
  return { rows, model };
}

const level = (quantity: number, storeId = STORE) => ({ storeId, productId: PRODUCT, variantId: VARIANT, quantity, productName: 'Lawn suit (Blue)' });
const open = (rows: Array<Record<string, any>>) => rows.filter((r) => r.open);

test('the threshold is the storefront "Only N left" line', () => {
  assert.equal(STOCK_WARNING_THRESHOLD, 5);
});

test('dropping to the threshold opens one low-stock alert; further sales do not add more', async () => {
  const { rows, model } = fakeAlerts();
  assert.equal((await applyStockLevel(model, level(8))).outcome, 'none');
  const first = await applyStockLevel(model, level(5));
  assert.equal(first.outcome, 'low_stock');
  assert.ok(first.alertId);
  assert.equal((await applyStockLevel(model, level(4))).outcome, 'duplicate');
  assert.equal((await applyStockLevel(model, level(1))).outcome, 'duplicate');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.dedupeKey, 'lowstock:' + VARIANT);
  assert.equal(rows[0]!.title, 'Only 5 left of Lawn suit (Blue)');
  assert.equal(rows[0]!.link, '/inventory');
});

test('reaching 0 opens one out-of-stock alert of its own', async () => {
  const { rows, model } = fakeAlerts();
  await applyStockLevel(model, level(2));
  assert.equal((await applyStockLevel(model, level(0))).outcome, 'out_of_stock');
  assert.equal((await applyStockLevel(model, level(0))).outcome, 'duplicate');
  assert.deepEqual(open(rows).map((r) => r.kind).sort(), ['low_stock', 'out_of_stock']);
});

test('stock back above the threshold resolves the open alerts, so a later drop alerts again', async () => {
  const { rows, model } = fakeAlerts();
  await applyStockLevel(model, level(3));
  await applyStockLevel(model, level(0));
  const resolved = await applyStockLevel(model, level(20));
  assert.equal(resolved.outcome, 'resolved');
  assert.equal(open(rows).length, 0);
  assert.ok(rows.every((r) => r.resolvedAt instanceof Date));

  assert.equal((await applyStockLevel(model, level(5))).outcome, 'low_stock', 'a new drop is a new alert');
  assert.equal(rows.length, 3);
  assert.equal(open(rows).length, 1);
});

test('a partial restock from 0 closes the out-of-stock alert but keeps one low-stock alert', async () => {
  const { rows, model } = fakeAlerts();
  await applyStockLevel(model, level(0));
  assert.equal((await applyStockLevel(model, level(3))).outcome, 'low_stock');
  assert.deepEqual(open(rows).map((r) => r.kind), ['low_stock']);
});

test('alerts of another store are never touched', async () => {
  const { rows, model } = fakeAlerts();
  await applyStockLevel(model, level(2, OTHER_STORE));
  await applyStockLevel(model, level(50, STORE));
  assert.equal(open(rows).length, 1);
  assert.equal(open(rows)[0]!.store, OTHER_STORE);
  assert.equal((await applyStockLevel(model, level(2, STORE))).outcome, 'low_stock', 'the same variant key in another store is its own alert');
});

test('only changes at or under the line are looked at', () => {
  assert.equal(stockAlertRelevant(20, -1), false);
  assert.equal(stockAlertRelevant(5, -1), true);
  assert.equal(stockAlertRelevant(6, 2), true, 'a restock from 4 to 6 can resolve');
  assert.equal(stockAlertRelevant(30, 10), false);
});
