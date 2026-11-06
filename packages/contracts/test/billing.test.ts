
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripeOnboardRequestSchema, stripeOnboardResponseSchema } from '../src/billing';
import { failingPaths } from './helpers';

test('an onboarding request needs a store id', () => {
  assert.deepEqual(failingPaths(stripeOnboardRequestSchema.safeParse({})), ['storeId']);
});

test('an onboarding response needs an https-style url', () => {
  assert.equal(stripeOnboardResponseSchema.safeParse({ url: 'https://connect.stripe.com/setup/x' }).success, true);
  assert.deepEqual(failingPaths(stripeOnboardResponseSchema.safeParse({ url: 'not a url' })), ['url']);
});
