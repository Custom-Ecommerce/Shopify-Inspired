import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';

// Sprint 5 EP-13 (D-107): the policy rows of the return actions, and the public route's system actor.

const ACTORS = ['admin', 'system', 'public'] as const;

test('returnActions: a seller may update reason, items, amount, method and reference only; no field list or another field is denied', () => {
  assert.equal(can('seller', 'update', 'returnActions', ['reason']), true);
  assert.equal(can('seller', 'update', 'returnActions', ['items']), true);
  assert.equal(can('seller', 'update', 'returnActions', ['amount', 'method', 'reference']), true);
  for (const field of ['status', 'refundAmount', 'refunds', 'received', 'store', 'order', 'contactPhone', 'returnNumber']) {
    assert.equal(can('seller', 'update', 'returnActions', ['amount', field]), false, field);
  }
  assert.equal(can('seller', 'update', 'returnActions'), false);
  for (const operation of ['read', 'create', 'delete'] as const) assert.equal(can('seller', operation, 'returnActions', ['reason']), false, operation);
});

test('returnActions: the admin, the system and the public have no row', () => {
  for (const actor of ACTORS) for (const operation of ['read', 'create', 'update', 'delete'] as const) assert.equal(can(actor, operation, 'returnActions', ['reason']), false, actor + ' ' + operation);
});

test('returns: only the system creates one (the public return route acts as the system actor); a seller cannot', () => {
  assert.equal(can('system', 'create', 'returns', ['order', 'items', 'contactPhone']), true);
  assert.equal(can('seller', 'create', 'returns', ['order']), false);
  assert.equal(can('public', 'create', 'returns', ['order']), false);
  assert.equal(can('admin', 'create', 'returns', ['order']), false);
});

test('returns: the seller still reads and may update status, refundType and refundAmount only through the generic PATCH', () => {
  assert.equal(can('seller', 'read', 'returns'), true);
  assert.equal(can('seller', 'update', 'returns', ['status', 'refundType', 'refundAmount']), true);
  for (const field of ['refunds', 'received', 'items', 'contactPhone', 'returnNumber']) assert.equal(can('seller', 'update', 'returns', [field]), false, field);
});
