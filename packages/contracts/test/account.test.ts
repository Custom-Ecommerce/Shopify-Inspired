import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountProfileUpdateSchema,
  passwordProblem,
  resetPasswordRequestSchema,
  sellerAccountStatusRequestSchema,
  signupRequestSchema,
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
