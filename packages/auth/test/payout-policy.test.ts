import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';

// Sprint 4 EP-05.US03, US04, US06: the policy rows of payouts, the full payout account, earnings and the commission report.

test('payouts: only an admin makes, finishes or voids one; nobody deletes one', () => {
  assert.equal(can('admin', 'create', 'payouts'), true);
  assert.equal(can('admin', 'update', 'payouts'), true);
  for (const actor of ['seller', 'system', 'public'] as const) {
    assert.equal(can(actor, 'create', 'payouts'), false, actor);
    assert.equal(can(actor, 'update', 'payouts'), false, actor);
  }
  for (const actor of ['admin', 'seller', 'system', 'public'] as const) assert.equal(can(actor, 'delete', 'payouts'), false, actor);
});

test('payouts: a seller reads only the listed fields of their payouts, never who made or voided one', () => {
  assert.equal(can('seller', 'read', 'payouts', ['amount', 'method', 'reference', 'status', 'createdAt']), true);
  for (const field of ['createdBy', 'voidReason', 'payoutDetailsSnapshot', 'note']) assert.equal(can('seller', 'read', 'payouts', [field]), false, field);
  assert.equal(can('admin', 'read', 'payouts', ['createdBy', 'voidReason']), true);
  assert.equal(can('public', 'read', 'payouts'), false);
});

test('payoutDetails: the full payout account is readable by an admin only, and nothing writes it through this row', () => {
  assert.equal(can('admin', 'read', 'payoutDetails'), true);
  for (const actor of ['seller', 'system', 'public'] as const) assert.equal(can(actor, 'read', 'payoutDetails'), false, actor);
  for (const operation of ['create', 'update', 'delete'] as const) assert.equal(can('admin', operation, 'payoutDetails'), false, operation);
});

test('earnings: a seller reads their own; an admin and the public have no row', () => {
  assert.equal(can('seller', 'read', 'earnings'), true);
  for (const actor of ['admin', 'system', 'public'] as const) assert.equal(can(actor, 'read', 'earnings'), false, actor);
  for (const operation of ['create', 'update', 'delete'] as const) assert.equal(can('seller', operation, 'earnings'), false, operation);
});

test('commissionReport: admin only, read only', () => {
  assert.equal(can('admin', 'read', 'commissionReport'), true);
  for (const actor of ['seller', 'system', 'public'] as const) assert.equal(can(actor, 'read', 'commissionReport'), false, actor);
  for (const operation of ['create', 'update', 'delete'] as const) assert.equal(can('admin', operation, 'commissionReport'), false, operation);
});

// Sprint 4 EP-07.US04 (SB-8): customers and broadcasts.

test('customers: a seller reads them; an admin, the system and the public have no row; nothing writes them', () => {
  assert.equal(can('seller', 'read', 'customers'), true);
  for (const actor of ['admin', 'system', 'public'] as const) assert.equal(can(actor, 'read', 'customers'), false, actor);
  for (const operation of ['create', 'update', 'delete'] as const) assert.equal(can('seller', operation, 'customers'), false, operation);
});

test('broadcasts: a seller reads and creates them; nobody else; nobody edits or deletes one', () => {
  assert.equal(can('seller', 'read', 'broadcasts'), true);
  assert.equal(can('seller', 'create', 'broadcasts'), true);
  for (const actor of ['admin', 'system', 'public'] as const) {
    assert.equal(can(actor, 'read', 'broadcasts'), false, actor);
    assert.equal(can(actor, 'create', 'broadcasts'), false, actor);
  }
  for (const operation of ['update', 'delete'] as const) assert.equal(can('seller', operation, 'broadcasts'), false, operation);
});
