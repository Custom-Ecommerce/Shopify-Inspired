
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommissionLedgerModel, SubscriptionPlanModel, PlatformSettingsModel, PLAN_KEY_PATTERN } from '../src';

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

test('Sprint 6: a plan without a tier is valid (the old tier is readable, no longer required)', () => {
  const doc = new SubscriptionPlanModel({ name: 'Pro', stripePriceId: 'price_123' });
  assert.equal(doc.validateSync(), undefined);
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

test('platform settings: the COD commission percent defaults to 0 and shares the bounds of the default rate (D-116)', () => {
  const doc = new PlatformSettingsModel({ globalType: 'platformSettings' });
  assert.equal(doc.codCommissionPercent, 0);
  assert.equal(new PlatformSettingsModel({ globalType: 'platformSettings', codCommissionPercent: 100 }).validateSync(), undefined);
  assert.notEqual(new PlatformSettingsModel({ globalType: 'platformSettings', codCommissionPercent: 100.5 }).validateSync(), undefined);
  assert.notEqual(new PlatformSettingsModel({ globalType: 'platformSettings', codCommissionPercent: -1 }).validateSync(), undefined);
});

test('platform settings: plan settings default to a 7 day grace, no trial and no texts (D-118)', () => {
  const doc = new PlatformSettingsModel({ globalType: 'platformSettings' });
  assert.equal(doc.graceDays, 7);
  assert.equal(doc.trialDays, 0);
  assert.equal(doc.paymentInstructions, undefined);
  assert.equal(doc.supportEmail, undefined);
  assert.equal(doc.supportPhone, undefined);
});

test('platform settings: grace days 0 to 30, trial days 0 to 60, payment instructions at most 1000 characters', () => {
  const make = (extra: Record<string, unknown>) => new PlatformSettingsModel({ globalType: 'platformSettings', ...extra }).validateSync();
  assert.equal(make({ graceDays: 30, trialDays: 60 }), undefined);
  assert.notEqual(make({ graceDays: 31 }), undefined);
  assert.notEqual(make({ graceDays: -1 }), undefined);
  assert.notEqual(make({ trialDays: 61 }), undefined);
  assert.equal(make({ paymentInstructions: 'x'.repeat(1000) }), undefined);
  assert.notEqual(make({ paymentInstructions: 'x'.repeat(1001) }), undefined);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-14 (D-118): plans are data.

const growth = {
  key: 'growth',
  name: 'Growth',
  priceRs: 2500,
  limits: { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true },
  features: ['Unlimited products', 'Premium themes'],
};

test('Sprint 6: a new plan validates and takes its defaults (month, active, sort order 0, revision 0, not archived)', () => {
  const doc = new SubscriptionPlanModel(growth);
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.interval, 'month');
  assert.equal(doc.isActive, true);
  assert.equal(doc.sortOrder, 0);
  assert.equal(doc.revision, 0);
  assert.equal(doc.archivedAt, null);
  assert.equal(doc.stripePriceId, undefined, 'the Stripe price is optional');
  assert.equal(doc.limits?.products, null, 'null is unlimited');
  assert.equal(doc.limits?.stores, 3);
  assert.equal(doc.limits?.customDomain, true);
});

test('Sprint 6: a plan with a price of 0 is valid (Free), and the price is whole rupees', () => {
  const free = { key: 'free', name: 'Free', priceRs: 0, limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false } };
  assert.equal(new SubscriptionPlanModel(free).validateSync(), undefined);
  assert.notEqual(new SubscriptionPlanModel({ ...free, priceRs: 2500.5 }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPlanModel({ ...free, priceRs: -1 }).validateSync(), undefined);
});

test('Sprint 6: limits are whole numbers of 0 or more, or null; the two switches default to false', () => {
  const make = (limits: Record<string, unknown>) => new SubscriptionPlanModel({ ...growth, limits }).validateSync();
  assert.equal(make({ stores: 0, products: 0, staffSeats: 0, apiKeys: 0 }), undefined);
  assert.notEqual(make({ stores: -1 }), undefined);
  assert.notEqual(make({ products: 2.5 }), undefined);
  assert.notEqual(make({ apiKeys: -3 }), undefined);
  const defaulted = new SubscriptionPlanModel({ ...growth, limits: {} });
  assert.equal(defaulted.limits?.customDomain, false);
  assert.equal(defaulted.limits?.premiumThemes, false);
  assert.equal(defaulted.limits?.stores, null);
});

test('Sprint 6: the key is a slug; anything else is refused', () => {
  for (const good of ['free', 'growth', 'pro-2', 'ab']) assert.equal(new SubscriptionPlanModel({ ...growth, key: good }).validateSync(), undefined, good);
  for (const bad of ['Growth', '1plan', 'a', 'has space', 'under_score', 'x'.repeat(31), '-lead']) assert.notEqual(new SubscriptionPlanModel({ ...growth, key: bad }).validateSync(), undefined, bad);
  assert.equal(PLAN_KEY_PATTERN.test('growth'), true);
});

test('Sprint 6: an old plan (name, price id, tier only) still loads and validates, with no key, price or limits', () => {
  const old = new SubscriptionPlanModel({ name: 'Pro', stripePriceId: 'price_123', tier: 'pro' });
  assert.equal(old.validateSync(), undefined);
  assert.equal(old.tier, 'pro');
  assert.equal(old.key, undefined);
  assert.equal(old.priceRs, undefined);
  assert.equal(old.limits, undefined);
  assert.equal(old.isActive, true);
});

test('Sprint 6: the key has a unique index that is partial, so old plans without a key do not collide', () => {
  const indexes = (SubscriptionPlanModel as unknown as { schema: { indexes: () => Array<[Record<string, number>, Record<string, any>]> } }).schema.indexes();
  const unique = indexes.find(([, options]) => options?.unique);
  assert.ok(unique, 'a unique index is declared');
  assert.deepEqual(unique![0], { key: 1 });
  assert.equal(unique![1].name, 'plan_key_unique');
  assert.deepEqual(unique![1].partialFilterExpression, { key: { $type: 'string' } });
});

test('Sprint 6: a plan name is required and at most 60 characters; a tier outside the old three is refused', () => {
  assert.notEqual(new SubscriptionPlanModel({ ...growth, name: undefined }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPlanModel({ ...growth, name: 'x'.repeat(61) }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPlanModel({ ...growth, tier: 'gold' }).validateSync(), undefined);
  assert.notEqual(new SubscriptionPlanModel({ ...growth, interval: 'year' }).validateSync(), undefined);
});
