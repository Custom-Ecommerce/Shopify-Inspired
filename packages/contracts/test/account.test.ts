import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountProfileUpdateSchema,
  internalStoreLimitRequestSchema,
  passwordProblem,
  resetPasswordRequestSchema,
  sellerAccountStatusRequestSchema,
  sellerStoreLimitRequestSchema,
  signupRequestSchema,
  storeLimitOverrideSchema,
} from '../src';

// Sprint 4 EP-08: the account contracts.

test('signup and reset share one password rule: 8 to 128 characters', () => {
  assert.equal(signupRequestSchema.safeParse({ name: 'Ali', email: 'ali@example.com', password: 'longenough' }).success, true);
  assert.equal(signupRequestSchema.safeParse({ name: 'Ali', email: 'ali@example.com', password: 'short' }).success, false);
  assert.equal(resetPasswordRequestSchema.safeParse({ token: 't', password: 'x'.repeat(129) }).success, false);
  assert.equal(passwordProblem('longenough'), null);
  assert.ok(passwordProblem('short'));
});

test('the profile phone follows the shared Pakistani rule; empty clears it; unknown keys are refused', () => {
  assert.deepEqual(accountProfileUpdateSchema.parse({ phone: '0300-1234567' }), { phone: '+923001234567' });
  assert.deepEqual(accountProfileUpdateSchema.parse({ phone: '' }), { phone: null });
  assert.equal(accountProfileUpdateSchema.safeParse({ phone: '12345' }).success, false);
  assert.equal(accountProfileUpdateSchema.safeParse({}).success, false);
  assert.equal(accountProfileUpdateSchema.safeParse({ email: 'x@example.com' }).success, false);
});

test('suspending needs a reason of 3 to 300 characters; unsuspending does not', () => {
  assert.equal(sellerAccountStatusRequestSchema.safeParse({ status: 'suspended' }).success, false);
  assert.equal(sellerAccountStatusRequestSchema.safeParse({ status: 'suspended', reason: 'no' }).success, false);
  assert.equal(sellerAccountStatusRequestSchema.safeParse({ status: 'suspended', reason: 'x'.repeat(301) }).success, false);
  assert.equal(sellerAccountStatusRequestSchema.safeParse({ status: 'suspended', reason: 'Fake products' }).success, true);
  assert.equal(sellerAccountStatusRequestSchema.safeParse({ status: 'active' }).success, true);
});

// Sprint 6 EP-12.US02: the store-limit override.

test('the store-limit override is a whole number of 1 or more, or null', () => {
  for (const good of [1, 2, 3, 1000, null]) assert.equal(storeLimitOverrideSchema.safeParse(good).success, true, String(good));
  for (const bad of [0, -1, 1.5, 1001, '3', undefined, Number.NaN]) assert.equal(storeLimitOverrideSchema.safeParse(bad).success, false, String(bad));
});

test('setting a store limit needs a reason of 3 to 300 characters; clearing it (null) needs one too', () => {
  assert.equal(sellerStoreLimitRequestSchema.safeParse({ storeLimitOverride: 5, reason: 'Agency account' }).success, true);
  assert.equal(sellerStoreLimitRequestSchema.safeParse({ storeLimitOverride: null, reason: 'Back to the plan' }).success, true);
  assert.equal(sellerStoreLimitRequestSchema.safeParse({ storeLimitOverride: 5 }).success, false);
  assert.equal(sellerStoreLimitRequestSchema.safeParse({ storeLimitOverride: 5, reason: 'no' }).success, false);
  assert.equal(sellerStoreLimitRequestSchema.safeParse({ storeLimitOverride: 5, reason: 'x'.repeat(301) }).success, false);
  assert.equal(sellerStoreLimitRequestSchema.safeParse({ reason: 'Agency account' }).success, false);
  assert.equal(sellerStoreLimitRequestSchema.safeParse({ storeLimitOverride: 5, reason: 'Agency account', extra: 1 }).success, false);
});

test('the signed internal store-limit call carries the user id and the override only', () => {
  const userId = '65a000000000000000000001';
  assert.equal(internalStoreLimitRequestSchema.safeParse({ userId, storeLimitOverride: 4 }).success, true);
  assert.equal(internalStoreLimitRequestSchema.safeParse({ userId, storeLimitOverride: null }).success, true);
  assert.equal(internalStoreLimitRequestSchema.safeParse({ userId: 'nope', storeLimitOverride: 4 }).success, false);
  assert.equal(internalStoreLimitRequestSchema.safeParse({ userId, storeLimitOverride: 0 }).success, false);
  assert.equal(internalStoreLimitRequestSchema.safeParse({ userId, storeLimitOverride: 4, reason: 'x' }).success, false);
});
