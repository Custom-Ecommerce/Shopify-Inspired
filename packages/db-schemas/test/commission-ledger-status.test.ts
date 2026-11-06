import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommissionLedgerModel } from '../src/billing/commission-ledger';

const base = {
  orderId: 'ord_1',
  sellerOrderDocId: 'so_1',
  orderAmount: -5000,
  commissionRate: 4,
  commissionAmount: -200,
  paymentMethod: 'card',
  refundId: 're_1',
  settlementRef: 'refund:re_1',
};

// Billing writes a refund reversal with status refunded through the real model. The validation must accept it.
test('a refund reversal row with status refunded passes the ledger schema', () => {
  const doc = new CommissionLedgerModel({ ...base, status: 'refunded' });
  assert.equal(doc.validateSync(), undefined);
});

test('an unknown ledger status is still refused', () => {
  const doc = new CommissionLedgerModel({ ...base, status: 'paid' });
  assert.ok(doc.validateSync());
});
