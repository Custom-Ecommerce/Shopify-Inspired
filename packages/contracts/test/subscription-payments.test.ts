import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminPaymentListQuerySchema,
  adminPaymentListSchema,
  adminPaymentSchema,
  cancelRequestSchema,
  claimPaymentRequestSchema,
  confirmPaymentBodySchema,
  decidePaymentBodySchema,
  downgradeRequestSchema,
  internalConfirmPaymentRequestSchema,
  ownPaymentSchema,
  ownSubscriptionResponseSchema,
  paymentInstructionsSchema,
  upgradeRequestSchema,
} from '../src/subscription-payments';
import { failingPaths } from './helpers';

// Sprint 6 (S6-B4, D-118): the payment contracts. Whole rupees, strict objects, one named field per problem.

const ID = '65a0000000000000000000d1';
const NOW = '2026-11-20T10:00:00.000Z';

test('an upgrade request is the plan key and nothing else: an amount is refused, not ignored', () => {
  assert.equal(upgradeRequestSchema.safeParse({ planKey: 'growth' }).success, true);
  for (const extra of [{ amountRs: 1 }, { priceRs: 1 }, { status: 'confirmed' }, { seller: ID }]) assert.equal(upgradeRequestSchema.safeParse({ planKey: 'growth', ...extra }).success, false, JSON.stringify(extra));
  assert.deepEqual(failingPaths(upgradeRequestSchema.safeParse({ planKey: 'Not A Key' })), ['planKey']);
  assert.equal(upgradeRequestSchema.safeParse({}).success, false);
});

test('I paid: a payment id, a method, a reference and an optional https proof', () => {
  const ok = { paymentId: ID, method: 'jazzcash', reference: ' TX-77812 ' };
  assert.equal(claimPaymentRequestSchema.parse(ok).reference, 'TX-77812');
  assert.equal(claimPaymentRequestSchema.safeParse({ ...ok, proofUrl: 'https://example.com/slip.jpg' }).success, true);
  assert.equal(claimPaymentRequestSchema.safeParse({ ...ok, proofUrl: null }).success, true);
  for (const method of ['bank', 'jazzcash', 'easypaisa', 'other']) assert.equal(claimPaymentRequestSchema.safeParse({ ...ok, method }).success, true, method);
  for (const [bad, path] of [
    [{ ...ok, method: 'cash' }, 'method'],
    [{ ...ok, reference: '' }, 'reference'],
    [{ ...ok, reference: 'x'.repeat(101) }, 'reference'],
    [{ ...ok, reference: '<b>1</b>' }, 'reference'],
    [{ ...ok, paymentId: 'nope' }, 'paymentId'],
    [{ ...ok, proofUrl: 'http://example.com/a.jpg' }, 'proofUrl'],
    [{ ...ok, proofUrl: 'javascript:alert(1)' }, 'proofUrl'],
    [{ ...ok, proofUrl: 'https://' + 'x'.repeat(300) }, 'proofUrl'],
  ] as const) {
    assert.deepEqual(failingPaths(claimPaymentRequestSchema.safeParse(bad)), [path], JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(claimPaymentRequestSchema.safeParse({ ...ok, amountRs: 1 }).success, false, 'no amount from the seller');
  assert.equal(claimPaymentRequestSchema.safeParse({ ...ok, status: 'confirmed' }).success, false);
});

test('downgrade takes a plan key or null; cancel takes a boolean', () => {
  assert.equal(downgradeRequestSchema.safeParse({ planKey: 'free' }).success, true);
  assert.equal(downgradeRequestSchema.safeParse({ planKey: null }).success, true);
  assert.equal(downgradeRequestSchema.safeParse({}).success, false);
  assert.equal(downgradeRequestSchema.safeParse({ planKey: 'free', now: true }).success, false);
  assert.equal(cancelRequestSchema.safeParse({ cancelAtPeriodEnd: true }).success, true);
  assert.equal(cancelRequestSchema.safeParse({ cancelAtPeriodEnd: false }).success, true);
  assert.equal(cancelRequestSchema.safeParse({ cancelAtPeriodEnd: 'yes' }).success, false);
});

test('confirm: the amount the admin saw in whole rupees and a reason of 3 or more; reject and void: a reason of 5 or more', () => {
  assert.equal(confirmPaymentBodySchema.safeParse({ amountRs: 2500, reason: 'Slip checked' }).success, true);
  for (const bad of [{ amountRs: 2500.5, reason: 'Slip checked' }, { amountRs: 0, reason: 'Slip checked' }, { amountRs: '2500', reason: 'Slip checked' }, { amountRs: 2500, reason: 'ok' }, { amountRs: 2500 }, { reason: 'Slip checked' }, { amountRs: 2500, reason: 'Slip checked', status: 'confirmed' }]) {
    assert.equal(confirmPaymentBodySchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  assert.equal(decidePaymentBodySchema.safeParse({ reason: 'Amount does not match' }).success, true);
  assert.equal(decidePaymentBodySchema.safeParse({ reason: 'nope' }).success, false, '4 characters');
  assert.equal(decidePaymentBodySchema.safeParse({ reason: 'x'.repeat(301) }).success, false);
  assert.equal(decidePaymentBodySchema.safeParse({ reason: 'fine reason', extra: 1 }).success, false);
  assert.equal(internalConfirmPaymentRequestSchema.safeParse({ paymentId: ID, amountRs: 2500, reason: 'Slip checked' }).success, true);
  assert.equal(internalConfirmPaymentRequestSchema.safeParse({ paymentId: 'x', amountRs: 2500, reason: 'Slip checked' }).success, false);
});

test('the admin list query defaults to page 1, 20 per page; a status filter must be one of the five; no unknown parameter', () => {
  assert.deepEqual(adminPaymentListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.deepEqual(adminPaymentListQuerySchema.parse({ status: 'claimed', page: '2', limit: '50' }), { status: 'claimed', page: 2, limit: 50 });
  for (const bad of [{ status: 'paid' }, { page: '0' }, { limit: '101' }, { sort: 'amount' }]) assert.equal(adminPaymentListQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
});

const own = { id: ID, planKey: 'growth', amountRs: 2500, status: 'claimed', method: 'bank', reference: 'TX-1', proofUrl: null, periodStart: null, periodEnd: null, reason: null, createdAt: NOW, claimedAt: NOW, decidedAt: null };

test('what a seller reads: their payment without the admin\'s bookkeeping, and the subscription with its pending plan', () => {
  assert.equal(ownPaymentSchema.safeParse(own).success, true);
  assert.equal(ownPaymentSchema.safeParse({ ...own, amountRs: 2500.5 }).success, false);
  const stripped = ownPaymentSchema.parse({ ...own, decidedBy: 'admin:1', revision: 3, seller: ID }) as Record<string, unknown>;
  assert.equal('decidedBy' in stripped, false);
  assert.equal('revision' in stripped, false);
  const subscription = { planKey: 'growth', status: 'active', periodStart: NOW, currentPeriodEnd: NOW, graceUntil: null, trialEndsAt: null, cancelAtPeriodEnd: false, pendingPlanKey: 'free', source: 'manual' };
  assert.equal(ownSubscriptionResponseSchema.safeParse({ subscription, open: own, payments: [own] }).success, true);
  assert.equal(ownSubscriptionResponseSchema.safeParse({ subscription: null, open: null, payments: [] }).success, true);
  assert.equal(paymentInstructionsSchema.safeParse({ paymentInstructions: null, supportEmail: null, supportPhone: null }).success, true);
});

test('what an admin reads: the seller, the plan name, the decision and the revision; the list carries the pending count', () => {
  const row = { ...own, seller: { id: ID, name: 'Ayesha', email: 'a@example.com' }, planName: 'Growth', decidedBy: null, revision: 1 };
  assert.equal(adminPaymentSchema.safeParse(row).success, true);
  assert.equal(adminPaymentListSchema.safeParse({ docs: [row], page: 1, limit: 20, totalDocs: 1, totalPages: 1, pendingCount: 1 }).success, true);
  assert.equal(adminPaymentListSchema.safeParse({ docs: [row], page: 1, limit: 20, totalDocs: 1, totalPages: 1 }).success, false);
  assert.equal(adminPaymentSchema.safeParse({ ...row, status: 'paid' }).success, false);
});
