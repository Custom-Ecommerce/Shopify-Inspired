import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFECTIVE_PLAN_STATUSES,
  adminSellerPlansResponseSchema,
  expiryJobRequestSchema,
  expiryJobResponseSchema,
  internalSellerPlansRequestSchema,
  planLimitRefusalSchema,
  planUsageSchema,
} from '../src/subscription';
import { failingPaths } from './helpers';

// Sprint 6 EP-14 (D-118): the subscription contracts.

const NOW = '2026-11-20T10:00:00.000Z';
const OID = '65a000000000000000000001';
const limits = { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true };
const used = { stores: 1, products: 12, staffSeats: 0, apiKeys: 0 };
const usage = {
  plan: { key: 'growth', name: 'Growth' },
  status: 'active',
  subscribedPlanKey: 'growth',
  limits,
  used,
  periodEnd: NOW,
  graceUntil: null,
  daysLeft: 10,
  storeLimitOverridden: false,
  fallbackLimits: false,
};

test('plan usage parses, keeps null as unlimited, and takes every effective status', () => {
  assert.equal(planUsageSchema.safeParse(usage).success, true);
  for (const status of EFFECTIVE_PLAN_STATUSES) assert.equal(planUsageSchema.safeParse({ ...usage, status }).success, true, status);
  assert.deepEqual([...EFFECTIVE_PLAN_STATUSES], ['trial', 'active', 'grace', 'expired', 'cancelled', 'none']);
  assert.equal(planUsageSchema.safeParse({ ...usage, periodEnd: null, daysLeft: null, subscribedPlanKey: null, status: 'none' }).success, true);
});

test('plan usage refuses a bad status, a negative or fractional count, and a missing field', () => {
  for (const bad of [{ status: 'paused' }, { used: { ...used, products: -1 } }, { used: { ...used, stores: 1.5 } }, { limits: { ...limits, stores: -1 } }, { daysLeft: -1 }, { periodEnd: 'tomorrow' }]) {
    assert.equal(planUsageSchema.safeParse({ ...usage, ...bad }).success, false, JSON.stringify(bad));
  }
  const { used: _omit, ...noUsed } = usage;
  void _omit;
  assert.deepEqual(failingPaths(planUsageSchema.safeParse(noUsed)), ['used']);
});

test('the refusal body has the code, the limit, the use, the plan and an upgrade hint', () => {
  const refusal = { code: 'PLAN_LIMIT_REACHED', limit: 10, used: 10, plan: 'free', upgradeHint: 'Upgrade to Growth.' };
  assert.equal(planLimitRefusalSchema.safeParse(refusal).success, true);
  assert.equal(planLimitRefusalSchema.safeParse({ ...refusal, code: 'STORE_LIMIT_REACHED' }).success, false);
  assert.equal(planLimitRefusalSchema.safeParse({ ...refusal, limit: -1 }).success, false);
  assert.equal(planLimitRefusalSchema.safeParse({ ...refusal, upgradeHint: undefined }).success, false);
});

test('the admin seller plans answer and the signed request', () => {
  const row = { sellerId: OID, plan: { key: 'free', name: 'Free' }, status: 'none', periodEnd: null, daysLeft: null, limits, used };
  assert.equal(adminSellerPlansResponseSchema.safeParse({ plans: [row] }).success, true);
  assert.equal(adminSellerPlansResponseSchema.safeParse({ plans: [{ ...row, sellerId: 'x' }] }).success, false);
  assert.equal(internalSellerPlansRequestSchema.safeParse({ sellerIds: [OID] }).success, true);
  assert.equal(internalSellerPlansRequestSchema.safeParse({ sellerIds: [] }).success, false);
  assert.equal(internalSellerPlansRequestSchema.safeParse({ sellerIds: Array.from({ length: 101 }, () => OID) }).success, false);
  assert.equal(internalSellerPlansRequestSchema.safeParse({ sellerIds: ['nope'] }).success, false);
  assert.equal(internalSellerPlansRequestSchema.safeParse({ sellerIds: [OID], extra: 1 }).success, false);
});

test('the expiry job is a dry run unless apply is exactly true, and answers counts only', () => {
  assert.equal(expiryJobRequestSchema.safeParse({}).success, true);
  assert.equal(expiryJobRequestSchema.safeParse({ apply: true }).success, true);
  assert.equal(expiryJobRequestSchema.safeParse({ apply: 'yes' }).success, false);
  assert.equal(expiryJobRequestSchema.safeParse({ apply: true, force: true }).success, false);
  const counts = { dryRun: true, scanned: 3, trialToExpired: 1, activeToGrace: 1, graceToExpired: 1, cancelledToExpired: 0, skipped: 0, failed: 0 };
  assert.equal(expiryJobResponseSchema.safeParse(counts).success, true);
  assert.equal(expiryJobResponseSchema.safeParse({ ...counts, failed: -1 }).success, false);
});
