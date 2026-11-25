import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminCommissionRatesSchema, adminLedgerListSchema, adminSubscriptionPlanListSchema } from '../src/admin-commerce';

const OID = '65a000000000000000000001';
const NOW = '2026-10-11T10:00:00.000Z';
const meta = { totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };
const bucket = { count: 0, orderAmount: 0, commissionAmount: 0 };

const entry = {
  id: OID,
  store: { id: OID, name: 'Lahore Looms' },
  orderAmount: 125000,
  commissionRate: 4,
  commissionAmount: 5000,
  status: 'pending',
  paymentMethod: 'card',
  settlementDate: null,
  settlementRef: null,
  createdAt: NOW,
};

test('a ledger page with totals parses, and a refund reversal may be negative', () => {
  const body = { docs: [entry, { ...entry, orderAmount: -125000, commissionAmount: -5000 }], ...meta, totals: { pending: bucket, settled: bucket } };
  assert.equal(adminLedgerListSchema.safeParse(body).success, true);
});

test('a ledger row that leaks _id or a bad status is refused', () => {
  const totals = { pending: bucket, settled: bucket };
  assert.equal(adminLedgerListSchema.safeParse({ docs: [{ ...entry, id: undefined, _id: OID }], ...meta, totals }).success, false);
  assert.equal(adminLedgerListSchema.safeParse({ docs: [{ ...entry, status: 'paid' }], ...meta, totals }).success, false);
  assert.equal(adminLedgerListSchema.safeParse({ docs: [{ ...entry, commissionRate: -1 }], ...meta, totals }).success, false);
  assert.equal(adminLedgerListSchema.safeParse({ docs: [entry], ...meta }).success, false);
});

test('a ledger row may have no store, no method, and settlement details', () => {
  const row = { ...entry, store: null, paymentMethod: null, status: 'settled', settlementDate: NOW, settlementRef: 'SET-1' };
  assert.equal(adminLedgerListSchema.safeParse({ docs: [row], ...meta, totals: { pending: bucket, settled: bucket } }).success, true);
});

test('commission rates carry the default and a nullable effective rate', () => {
  const item = { id: OID, name: 'Looms', status: 'active', commissionMode: 'inherit', commissionRate: 0, effectiveRate: 4 };
  assert.equal(adminCommissionRatesSchema.safeParse({ docs: [item], ...meta, defaultRate: 4 }).success, true);
  assert.equal(adminCommissionRatesSchema.safeParse({ docs: [{ ...item, effectiveRate: null }], ...meta, defaultRate: null }).success, true);
  assert.equal(adminCommissionRatesSchema.safeParse({ docs: [{ ...item, commissionMode: 'fixed' }], ...meta, defaultRate: 4 }).success, false);
  assert.equal(adminCommissionRatesSchema.safeParse({ docs: [item], ...meta }).success, false);
});

test('subscription plans carry the tier counts and refuse an unknown tier', () => {
  const plan = { id: OID, name: 'Pro monthly', tier: 'pro', stripePriceId: 'price_123', createdAt: NOW, updatedAt: NOW };
  const counts = { basic: 1, pro: 1, premium: 0 };
  assert.equal(adminSubscriptionPlanListSchema.safeParse({ docs: [plan], ...meta, counts }).success, true);
  assert.equal(adminSubscriptionPlanListSchema.safeParse({ docs: [{ ...plan, tier: 'gold' }], ...meta, counts }).success, false);
  assert.equal(adminSubscriptionPlanListSchema.safeParse({ docs: [plan], ...meta }).success, false);
});

// Sprint 6 EP-14 (D-118): the plan row carries the new fields, and an old row still parses with defaults.

const counts = { basic: 0, pro: 0, premium: 0 };

test('Sprint 6: an old plan row (name, price id, tier) parses with no key, price or limits', () => {
  const old = { id: OID, name: 'Pro monthly', tier: 'pro', stripePriceId: 'price_123', createdAt: NOW, updatedAt: NOW };
  const parsed = adminSubscriptionPlanListSchema.parse({ docs: [old], ...meta, counts });
  assert.equal(parsed.docs[0]!.key, null);
  assert.equal(parsed.docs[0]!.priceRs, null);
  assert.equal(parsed.docs[0]!.limits, null);
  assert.equal(parsed.docs[0]!.isActive, true);
  assert.deepEqual(parsed.docs[0]!.features, []);
  assert.equal(parsed.docs[0]!.revision, 0);
});

test('Sprint 6: a new plan row has no tier and no Stripe price, and keeps its limits with null for unlimited', () => {
  const plan = {
    id: OID,
    name: 'Growth',
    key: 'growth',
    priceRs: 2500,
    limits: { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true },
    features: ['Unlimited products'],
    isActive: true,
    sortOrder: 2,
    revision: 4,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const parsed = adminSubscriptionPlanListSchema.parse({ docs: [plan], ...meta, counts });
  assert.equal(parsed.docs[0]!.tier, null);
  assert.equal(parsed.docs[0]!.stripePriceId, null);
  assert.equal(parsed.docs[0]!.limits!.products, null);
  assert.equal(adminSubscriptionPlanListSchema.safeParse({ docs: [{ ...plan, priceRs: 2500.5 }], ...meta, counts }).success, false);
  assert.equal(adminSubscriptionPlanListSchema.safeParse({ docs: [{ ...plan, limits: { ...plan.limits, stores: -1 } }], ...meta, counts }).success, false);
});
