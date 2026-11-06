
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, PolicyConfigError } from '../src/can';

test('seller update with no field list is denied (fail-closed)', () => {
assert.equal(can('seller', 'update', 'stores'), false);
});

test('seller update with an empty field list is denied', () => {
assert.equal(can('seller', 'update', 'stores', []), false);
});

test('seller may write an operations field', () => {
assert.equal(can('seller', 'update', 'stores', ['storefront']), true);
});

test('seller may write a nested path under an allowed field', () => {
assert.equal(can('seller', 'update', 'stores', ['storefront.heroBanners']), true);
});

test('seller may not write commissionRate or owner', () => {
assert.equal(can('seller', 'update', 'stores', ['commissionRate']), false);
assert.equal(can('seller', 'update', 'stores', ['owner']), false);
});

test('a lookalike prefix does not grant access', () => {
assert.equal(can('seller', 'update', 'stores', ['storefrontEvil']), false);
});

test('one disallowed field in a mixed request denies the whole request', () => {
assert.equal(can('seller', 'update', 'stores', ['storefront', 'owner']), false);
});

test('anonymous read without a field list is denied', () => {
assert.equal(can('public', 'read', 'stores'), false);
});

test('anonymous read of billing identifiers is denied', () => {
assert.equal(can('public', 'read', 'stores', ['stripeConnectedAccountId']), false);
});

test('anonymous read of storefront fields is allowed', () => {
assert.equal(can('public', 'read', 'stores', ['storefront']), true);
});

test('seller may not create sync-outbox rows; system may', () => {
assert.equal(can('seller', 'create', 'sync-outbox'), false);
assert.equal(can('system', 'create', 'sync-outbox'), true);
});

test('admin may not write passwordHash through a generic update', () => {
assert.equal(can('admin', 'update', 'users', ['passwordHash']), false);
});

test('admin may not change the platform settings revision', () => {
assert.equal(can('admin', 'update', 'platformSettings', ['settingsRevision']), false);
assert.equal(can('admin', 'update', 'platformSettings', ['defaultCommissionRate']), true);
});

test('audit entries are immutable, even for system', () => {
assert.equal(can('system', 'update', 'audit-log', ['x']), false);
assert.equal(can('system', 'delete', 'audit-log'), false);
});

test('admin may read ledger totals but not order identifiers', () => {
assert.equal(can('admin', 'read', 'commissionLedger', ['orderAmount']), true);
assert.equal(can('admin', 'read', 'commissionLedger', ['orderId']), false);
});

test('undeclared collection throws PolicyConfigError instead of allowing', () => {
assert.throws(() => can('admin', 'read', 'commissionLedgerView'), PolicyConfigError);
});
