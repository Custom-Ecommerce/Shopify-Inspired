import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';
import { sellerCan } from '../src/seller-capabilities';

// Sprint 8 (S8-B5, D-118): referrals are read-only for a seller, and in a store only the owner has them.

test('a seller reads referrals and cannot create, change or delete one; the public has nothing', () => {
  assert.equal(can('seller', 'read', 'referrals'), true);
  assert.equal(can('seller', 'create', 'referrals'), false);
  assert.equal(can('seller', 'update', 'referrals', ['status']), false);
  assert.equal(can('seller', 'update', 'referrals', ['monthsRewarded']), false);
  assert.equal(can('seller', 'delete', 'referrals'), false);
  assert.equal(can('public', 'read', 'referrals'), false);
});

test('referrals.read is owner only', () => {
  assert.equal(sellerCan('owner', 'referrals.read'), true);
  for (const role of ['manager', 'staff', 'support']) assert.equal(sellerCan(role, 'referrals.read'), false, role);
});
