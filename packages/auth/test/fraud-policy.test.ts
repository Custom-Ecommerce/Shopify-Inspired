import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';
import { ORDER_ACTIONS, POLICY_MATRIX } from '../src/policy';

// Sprint 5 EP-11 (D-107): the policy rows of the phone confirmation decision and of the blocklist.

const ACTORS = ['admin', 'system', 'public'] as const;
const OPERATIONS = ['read', 'create', 'update', 'delete'] as const;

test('orderConfirmation: a seller may update result and note only; every other operation and field is denied', () => {
  assert.equal(can('seller', 'update', 'orderConfirmation', ['result', 'note']), true);
  assert.equal(can('seller', 'update', 'orderConfirmation', ['result']), true);
  for (const field of ['confirmationStatus', 'confirmationLog', 'status', 'store', 'riskFlags', 'phone']) {
    assert.equal(can('seller', 'update', 'orderConfirmation', ['result', field]), false, field);
  }
  // No field list at all is denied (fail closed).
  assert.equal(can('seller', 'update', 'orderConfirmation'), false);
  for (const operation of ['read', 'create', 'delete'] as const) assert.equal(can('seller', operation, 'orderConfirmation', ['result']), false, operation);
});

test('orderConfirmation: the admin, the system and the public have no row', () => {
  for (const actor of ACTORS) for (const operation of OPERATIONS) assert.equal(can(actor, operation, 'orderConfirmation', ['result']), false, actor + ' ' + operation);
});

test('orderConfirmation is not part of ORDER_ACTIONS (its tests list that map as it was)', () => {
  assert.equal(Object.values(ORDER_ACTIONS).some((action) => action.collection === 'orderConfirmation'), false);
  assert.ok('orderConfirmation' in POLICY_MATRIX);
});

test('blockedContacts: a seller reads, adds kind, value and reason, and removes; nobody updates', () => {
  assert.equal(can('seller', 'read', 'blockedContacts'), true);
  assert.equal(can('seller', 'create', 'blockedContacts', ['kind', 'value', 'reason']), true);
  assert.equal(can('seller', 'create', 'blockedContacts', ['kind', 'value']), true);
  assert.equal(can('seller', 'delete', 'blockedContacts'), true);
  assert.equal(can('seller', 'update', 'blockedContacts', ['reason']), false);
  assert.equal(can('seller', 'update', 'blockedContacts'), false);
});

test('blockedContacts: no other field can be written (not the store, not who created it)', () => {
  for (const field of ['store', 'createdBy', 'createdAt', '_id']) assert.equal(can('seller', 'create', 'blockedContacts', ['kind', 'value', field]), false, field);
  assert.equal(can('seller', 'create', 'blockedContacts'), false);
});

test('blockedContacts: the admin, the system and the public have no row (a store blocklist is the seller\'s own)', () => {
  for (const actor of ACTORS) for (const operation of OPERATIONS) assert.equal(can(actor, operation, 'blockedContacts', ['kind', 'value']), false, actor + ' ' + operation);
});
