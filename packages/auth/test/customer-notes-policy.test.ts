import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';

// Sprint 5 EP-10.US02 (D-107): the policy row of a customer's private note and tags. The derived "customers" row stays read-only
// (see payout-policy.test.ts); the note is its own resource so that row does not gain a write.

test('customerNotes: a seller reads and updates the note and tags only; nobody creates or deletes through the policy', () => {
  assert.equal(can('seller', 'read', 'customerNotes'), true);
  assert.equal(can('seller', 'update', 'customerNotes'), true);
  assert.equal(can('seller', 'update', 'customerNotes', ['note', 'tags']), true);
  for (const operation of ['create', 'delete'] as const) assert.equal(can('seller', operation, 'customerNotes'), false, operation);
});

test('customerNotes: no other field can be written, and the admin, the system and the public have no row', () => {
  for (const field of ['store', 'key', 'updatedBy', 'createdAt']) assert.equal(can('seller', 'update', 'customerNotes', [field]), false, field);
  for (const actor of ['admin', 'system', 'public'] as const) {
    for (const operation of ['read', 'create', 'update', 'delete'] as const) assert.equal(can(actor, operation, 'customerNotes'), false, actor + ' ' + operation);
  }
});

test('customers stays read-only for a seller', () => {
  assert.equal(can('seller', 'read', 'customers'), true);
  for (const operation of ['create', 'update', 'delete'] as const) assert.equal(can('seller', operation, 'customers'), false, operation);
});
