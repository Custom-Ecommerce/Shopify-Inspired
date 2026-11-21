import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_MATRIX,
  ADMIN_LEVELS,
  AdminCapabilityError,
  adminCan,
  adminCapabilities,
  assertAdminCan,
  effectiveAdminLevel,
  isAdminLevel,
  type AdminCapability,
  type AdminLevel,
} from '../src/admin-levels';

// Sprint 6 (S6-B6, D-118): the capability matrix, every level against every capability. The expected table is written out here on purpose: a
// change to the matrix must change this test too.

const EXPECTED: Record<AdminLevel, readonly AdminCapability[]> = {
  owner: [...ADMIN_CAPABILITIES],
  finance: ['overview.read', 'payments.read', 'payments.decide', 'payouts.manage', 'commission.read', 'commission.write', 'plans.read'],
  operations: ['overview.read', 'sellers.read', 'sellers.status', 'sellers.store_limit', 'stores.read', 'stores.status', 'sync.read', 'sync.manage', 'plans.read', 'settings.read'],
  customer_support: ['orders.read', 'sellers.read', 'tickets.read', 'tickets.reply', 'contact.read'],
};

test('the four levels are owner, finance, operations and customer_support', () => {
  assert.deepEqual([...ADMIN_LEVELS], ['owner', 'finance', 'operations', 'customer_support']);
});

test('every level against every capability: allowed exactly where the matrix says, denied everywhere else', () => {
  for (const level of ADMIN_LEVELS) {
    for (const capability of ADMIN_CAPABILITIES) {
      assert.equal(adminCan(level, capability), EXPECTED[level].includes(capability), level + ' ' + capability);
    }
  }
});

test('the matrix of the prompt: finance cannot view orders or void a payment; only the owner voids, manages users and exports the audit', () => {
  assert.equal(adminCan('finance', 'orders.read'), false);
  assert.equal(adminCan('finance', 'payments.decide'), true);
  for (const level of ADMIN_LEVELS) assert.equal(adminCan(level, 'payments.void'), level === 'owner', level);
  for (const capability of ['users.manage', 'audit.export', 'audit.read', 'settings.write', 'plans.write'] as const) {
    for (const level of ADMIN_LEVELS) assert.equal(adminCan(level, capability), level === 'owner', level + ' ' + capability);
  }
  assert.equal(adminCan('customer_support', 'orders.read'), true);
  assert.equal(adminCan('customer_support', 'payouts.manage'), false);
  assert.equal(adminCan('operations', 'sellers.store_limit'), true);
  assert.equal(adminCan('operations', 'settings.write'), false);
});

test('the Sprint 7 capability names exist now', () => {
  for (const name of ['tickets.read', 'tickets.reply', 'contact.read'] as const) assert.ok((ADMIN_CAPABILITIES as readonly string[]).includes(name), name);
});

test('an admin with no level, or an unknown one, is an owner (back-compat); an unknown capability is denied to everyone', () => {
  assert.equal(effectiveAdminLevel(undefined), 'owner');
  assert.equal(effectiveAdminLevel(null), 'owner');
  assert.equal(effectiveAdminLevel('superuser'), null, 'a present but unknown level is NOT an owner (S6-B7)');
  assert.equal(adminCan(undefined, 'users.manage'), true);
  assert.equal(adminCan(null, 'audit.export'), true);
  for (const level of ADMIN_LEVELS) {
    assert.equal(adminCan(level, 'nothing.at_all'), false, level);
    assert.equal(adminCan(level, ''), false, level);
  }
  assert.equal(isAdminLevel('finance'), true);
  assert.equal(isAdminLevel('admin'), false);
});

test('adminCapabilities lists a level\'s capabilities, and assertAdminCan throws a named error', () => {
  assert.deepEqual(adminCapabilities('customer_support'), EXPECTED.customer_support);
  assert.deepEqual(adminCapabilities(undefined), [...ADMIN_CAPABILITIES]);
  assert.doesNotThrow(() => assertAdminCan('finance', 'payments.read'));
  assert.throws(() => assertAdminCan('finance', 'orders.read'), (err: unknown) => err instanceof AdminCapabilityError && err.capability === 'orders.read');
});

test('the matrix is frozen and lists no capability twice or one that does not exist', () => {
  assert.equal(Object.isFrozen(ADMIN_CAPABILITY_MATRIX), true);
  for (const level of ADMIN_LEVELS) {
    const list = ADMIN_CAPABILITY_MATRIX[level];
    assert.equal(new Set(list).size, list.length, level);
    for (const capability of list) assert.ok((ADMIN_CAPABILITIES as readonly string[]).includes(capability), level + ' ' + capability);
  }
});

test('S6-B7: a level that is present but not one of the four is denied everything and has no capabilities; only a missing level is an owner', () => {
  for (const garbage of ['superuser', 'Owner', 'OWNER', 'admin', '', ' owner', 0, false, {}, []]) {
    assert.equal(effectiveAdminLevel(garbage), null, JSON.stringify(garbage));
    for (const capability of ADMIN_CAPABILITIES) assert.equal(adminCan(garbage, capability), false, JSON.stringify(garbage) + ' ' + capability);
    assert.deepEqual(adminCapabilities(garbage), [], JSON.stringify(garbage));
    assert.throws(() => assertAdminCan(garbage, 'orders.read'), AdminCapabilityError);
  }
  assert.equal(effectiveAdminLevel(undefined), 'owner');
  assert.equal(effectiveAdminLevel(null), 'owner');
  assert.equal(adminCan(undefined, 'users.manage'), true);
});
