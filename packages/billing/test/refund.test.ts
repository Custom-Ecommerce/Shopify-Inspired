
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordRefundReversal } from '../src/commission';

const BASE = {
  store: '65a000000000000000000001',
  orderId: 'ORD-1',
  refundId: 're_1',
  sellerOrderDocId: 'seller-doc-1',
  refundAmountMinor: 10000,
  commissionRate: 4,
  paymentMethod: 'card',
  stripePaymentIntentId: 'pi_1',
};

test('a refund writes one negative reversal row with the commission reversed', async () => {
  const rows: Array<Record<string, unknown>> = [];
  const result = await recordRefundReversal(
    { create: async (doc) => { rows.push(doc); return doc; } },
    BASE,
  );
  assert.equal(result.recorded, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderAmount, -10000);
  assert.equal(rows[0].commissionAmount, -400);
  assert.equal(rows[0].status, 'refunded');
  assert.equal(rows[0].refundId, 're_1');
  assert.equal(rows[0].settlementRef, 'refund:re_1');
});

test('a replayed refund is not recorded twice (unique index on orderId, status, refundId)', async () => {
  const ledger = {
    create: async () => {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    },
  };
  const result = await recordRefundReversal(ledger, BASE);
  assert.equal(result.recorded, false);
});

test('invalid refund inputs are rejected before any write', async () => {
  let writes = 0;
  const ledger = { create: async () => { writes += 1; return {}; } };
  await assert.rejects(recordRefundReversal(ledger, { ...BASE, refundAmountMinor: 0 }));
  await assert.rejects(recordRefundReversal(ledger, { ...BASE, refundAmountMinor: 10.5 }));
  await assert.rejects(recordRefundReversal(ledger, { ...BASE, commissionRate: 101 }));
  await assert.rejects(recordRefundReversal(ledger, { ...BASE, refundId: '' }));
  assert.equal(writes, 0);
});

test('a commission rate above 100 is refused: the rate is always a percentage', async () => {
  await assert.rejects(
    recordRefundReversal({ create: async (doc) => doc }, { ...BASE, commissionRate: 150 }),
    /percentage between 0 and 100/,
  );
});
