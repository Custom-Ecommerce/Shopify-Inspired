
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommissionLedgerModel, SubscriptionPlanModel, PlatformSettingsModel } from '../src';

// In-memory checks against the Payload data shapes. No database connection is needed.

test('ledger accepts a Payload refund reversal row (negative amounts)', () => {
  const doc = new CommissionLedgerModel({
    orderId: 'ORD-1-refund', sellerOrderDocId: 'seller-doc-1', orderAmount: -500,
    commissionRate: 4, commissionAmount: -20, status: 'pending',
  });
  assert.equal(doc.validateSync(), undefined);
});

test('ledger requires orderId and sellerOrderDocId, as Payload does', () => {
  assert.notEqual(new CommissionLedgerModel({ sellerOrderDocId: 'x' }).validateSync(), undefined);
  assert.notEqual(new CommissionLedgerModel({ orderId: 'x' }).validateSync(), undefined);
});

test('ledger status is pending or settled only, as in Payload', () => {
  const doc = new CommissionLedgerModel({ orderId: 'x', sellerOrderDocId: 'y', status: 'reversed' });
  assert.notEqual(doc.validateSync(), undefined);
});

test('ledger uses the Payload collection name', () => {
  assert.equal(CommissionLedgerModel.collection.name, 'commissionLedger');
});

test('a plan in the shape Payload stores validates (name, stripePriceId, tier)', () => {
  const doc = new SubscriptionPlanModel({ name: 'Pro', stripePriceId: 'price_123', tier: 'pro' });
  assert.equal(doc.validateSync(), undefined);
});

test('a plan without a tier is rejected, as Payload requires', () => {
  const doc = new SubscriptionPlanModel({ name: 'Pro', stripePriceId: 'price_123' });
  assert.notEqual(doc.validateSync(), undefined);
});

test('a plan does not require the invented fields the earlier schema demanded', () => {
  const doc = new SubscriptionPlanModel({ name: 'Pro', stripePriceId: 'price_123', tier: 'basic' });
  assert.equal(doc.validateSync(), undefined);
});

test('platform settings is a view on the Payload globals collection', () => {
  assert.equal(PlatformSettingsModel.collection.name, 'globals');
});

test('platform settings default commission rate is 4 percent, as in Payload', () => {
  const doc = new PlatformSettingsModel({ globalType: 'platformSettings' });
  assert.equal(doc.defaultCommissionRate, 4);
  assert.equal(doc.maxStoresPerSeller, 3);
});

test('platform settings rejects a rate above 100 percent', () => {
  const doc = new PlatformSettingsModel({ globalType: 'platformSettings', defaultCommissionRate: 150 });
  assert.notEqual(doc.validateSync(), undefined);
});
