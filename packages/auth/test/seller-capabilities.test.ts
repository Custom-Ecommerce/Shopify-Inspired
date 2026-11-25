import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_ONLY_CAPABILITIES,
  SELLER_CAPABILITIES,
  SELLER_CAPABILITY_MATRIX,
  SELLER_ROLES,
  STAFF_ROLES,
  SellerCapabilityError,
  assertSellerCan,
  isSellerCapability,
  isSellerRole,
  isStaffRole,
  sellerCan,
  sellerCapabilities,
  settingsGroupCapabilities,
  type SellerCapability,
  type SellerRole,
} from '../src/seller-capabilities';

// Sprint 8 (S8-B2, D-118): the seller capability matrix, every role against every capability. The expected table is written out here on purpose: a
// change to the matrix must change this test too.

const OWNER_ONLY: readonly SellerCapability[] = [
  'settings.payments', 'settings.fraud', 'settings.domain', 'settings.payout', 'go_live', 'billing.manage', 'api_keys.manage', 'team.manage', 'earnings.read', 'payouts.manage', 'commission.read', 'referrals.read',
];

const EXPECTED: Record<SellerRole, readonly SellerCapability[]> = {
  owner: [...SELLER_CAPABILITIES],
  manager: SELLER_CAPABILITIES.filter((capability) => !OWNER_ONLY.includes(capability)),
  staff: ['alerts.read', 'store.view', 'orders.read', 'orders.write', 'orders.notes', 'products.read', 'products.write', 'categories.read', 'categories.write', 'media.read', 'media.write', 'inventory.read', 'inventory.write'],
  support: ['alerts.read', 'store.view', 'orders.read', 'orders.notes', 'returns.read', 'returns.write', 'customers.read', 'customers.write', 'reviews.read', 'reviews.reply', 'contact.read', 'contact.write', 'tickets.read', 'tickets.write'],
};

test('the roles are owner and the three staff roles; a member row can only be a staff role', () => {
  assert.deepEqual([...SELLER_ROLES], ['owner', 'manager', 'staff', 'support']);
  assert.deepEqual([...STAFF_ROLES], ['manager', 'staff', 'support']);
  assert.equal(isStaffRole('owner'), false);
  assert.equal(isStaffRole('manager'), true);
  assert.equal(isSellerRole('owner'), true);
  assert.equal(isSellerRole('admin'), false);
});

test('every role against every capability: allowed exactly where the matrix says, denied everywhere else', () => {
  for (const role of SELLER_ROLES) {
    for (const capability of SELLER_CAPABILITIES) {
      assert.equal(sellerCan(role, capability), EXPECTED[role].includes(capability), role + ' ' + capability);
    }
  }
});

test('the owner has every capability; the manager has every one except the owner-only list', () => {
  assert.deepEqual([...SELLER_CAPABILITY_MATRIX.owner], [...SELLER_CAPABILITIES]);
  assert.deepEqual([...OWNER_ONLY_CAPABILITIES].sort(), [...OWNER_ONLY].sort());
  for (const capability of OWNER_ONLY) {
    assert.equal(sellerCan('owner', capability), true, capability);
    for (const role of ['manager', 'staff', 'support'] as const) assert.equal(sellerCan(role, capability), false, role + ' ' + capability);
  }
  assert.equal(SELLER_CAPABILITY_MATRIX.manager.length, SELLER_CAPABILITIES.length - OWNER_ONLY.length);
});

test('the tax group: the owner and a manager may change it, staff and support may not', () => {
  assert.equal(sellerCan('owner', 'settings.tax'), true);
  assert.equal(sellerCan('manager', 'settings.tax'), true);
  assert.equal(sellerCan('staff', 'settings.tax'), false);
  assert.equal(sellerCan('support', 'settings.tax'), false);
  // ...while payments and fraud stay with the owner alone.
  for (const capability of ['settings.payments', 'settings.fraud'] as const) {
    assert.equal(sellerCan('manager', capability), false, capability);
  }
});

test('the matrix of the prompt: staff = orders, products, inventory; support = orders view and notes, returns, customers, reviews reply, contact and tickets', () => {
  assert.equal(sellerCan('staff', 'orders.write'), true);
  assert.equal(sellerCan('staff', 'inventory.write'), true);
  assert.equal(sellerCan('staff', 'returns.read'), false);
  assert.equal(sellerCan('staff', 'customers.read'), false);
  assert.equal(sellerCan('staff', 'settings.read'), false);
  assert.equal(sellerCan('support', 'orders.read'), true);
  assert.equal(sellerCan('support', 'orders.write'), false, 'support views orders and updates customer notes, it does not change an order');
  assert.equal(sellerCan('support', 'orders.notes'), true);
  assert.equal(sellerCan('support', 'products.read'), false);
  assert.equal(sellerCan('support', 'inventory.read'), false);
  assert.equal(sellerCan('support', 'reviews.reply'), true);
  assert.equal(sellerCan('support', 'contact.read'), true);
  assert.equal(sellerCan('support', 'tickets.write'), true);
  assert.equal(sellerCan('manager', 'orders.write'), true);
  assert.equal(sellerCan('manager', 'team.manage'), false);
});

test('fail closed: a missing or unknown role is denied everything, and is never read as the owner', () => {
  for (const role of [undefined, null, '', 'admin', 'Owner', 'OWNER', 'superuser', 'seller', 0, {}, []]) {
    for (const capability of SELLER_CAPABILITIES) assert.equal(sellerCan(role, capability), false, String(role) + ' ' + capability);
    assert.deepEqual(sellerCapabilities(role), []);
  }
});

test('an unknown capability is denied for every role, the owner included', () => {
  for (const role of SELLER_ROLES) {
    for (const capability of ['', 'everything', 'orders', 'team.manage ', 'TEAM.MANAGE', 'orders.delete', undefined, null, 7]) {
      assert.equal(sellerCan(role, capability), false, role + ' ' + String(capability));
    }
  }
  assert.equal(isSellerCapability('team.manage'), true);
  assert.equal(isSellerCapability('team'), false);
});

test('assertSellerCan throws a typed error naming the capability, and passes when allowed', () => {
  assert.doesNotThrow(() => assertSellerCan('owner', 'team.manage'));
  assert.throws(() => assertSellerCan('manager', 'team.manage'), (err: unknown) => err instanceof SellerCapabilityError && err.capability === 'team.manage');
  assert.throws(() => assertSellerCan(undefined, 'orders.read'), SellerCapabilityError);
});

test('every capability is listed once and has an owner row', () => {
  assert.equal(new Set(SELLER_CAPABILITIES).size, SELLER_CAPABILITIES.length);
  for (const role of SELLER_ROLES) {
    for (const capability of SELLER_CAPABILITY_MATRIX[role]) assert.ok(SELLER_CAPABILITIES.includes(capability), role + ' ' + capability);
  }
});

test('a settings update needs one capability per group it sends; groups the map does not name need settings.write', () => {
  assert.deepEqual(settingsGroupCapabilities(['tax']), ['settings.tax']);
  assert.deepEqual(settingsGroupCapabilities(['payments']), ['settings.payments']);
  assert.deepEqual(settingsGroupCapabilities(['fraud', 'tax']).sort(), ['settings.fraud', 'settings.tax']);
  assert.deepEqual(settingsGroupCapabilities(['profile', 'seo', 'delivery', 'themeConfig']), ['settings.write']);
  assert.deepEqual(settingsGroupCapabilities(['domain', 'payout']).sort(), ['settings.domain', 'settings.payout']);
  assert.deepEqual(settingsGroupCapabilities(['somethingNew']), ['settings.write']);
});

test('S8-B3: the bell and the safe settings subset are for every role; refunds and customer export are owner and manager only', () => {
  for (const role of SELLER_ROLES) {
    assert.equal(sellerCan(role, 'alerts.read'), true, role);
    assert.equal(sellerCan(role, 'store.view'), true, role);
  }
  for (const capability of ['returns.refund', 'customers.export'] as const) {
    assert.equal(sellerCan('owner', capability), true, capability);
    assert.equal(sellerCan('manager', capability), true, capability);
    assert.equal(sellerCan('staff', capability), false, capability);
    assert.equal(sellerCan('support', capability), false, capability);
  }
  assert.equal(sellerCan('support', 'returns.write'), true, 'support marks a return received');
  assert.equal(sellerCan('support', 'returns.refund'), false, 'but never refunds it');
  assert.equal(sellerCan('support', 'customers.read'), true);
  assert.equal(sellerCan('support', 'reviews.reply'), true);
  assert.equal(sellerCan('staff', 'reviews.read'), false);
  assert.equal(sellerCan('staff', 'customers.read'), false);
});
