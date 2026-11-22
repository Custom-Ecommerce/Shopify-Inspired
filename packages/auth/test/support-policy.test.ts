import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';
import { SELLER_CONTACT_FIELDS, SELLER_TICKET_FIELDS } from '../src/policy';

// Sprint 7 (S7-B4): the contactMessages and tickets policy rows, every actor.

test('contactMessages: the public form writes as the system; a seller reads, and may change only the status and the replies; nobody but the system deletes', () => {
  assert.equal(can('system', 'create', 'contactMessages', ['name', 'message', 'store']), true);
  for (const actor of ['seller', 'admin', 'public'] as const) assert.equal(can(actor, 'create', 'contactMessages', ['name']), false, actor);
  assert.equal(can('seller', 'read', 'contactMessages'), true);
  assert.equal(can('seller', 'update', 'contactMessages', ['status', 'replies']), true);
  for (const field of ['store', 'name', 'email', 'phone', 'message', 'consent', 'revision', 'scope', 'createdAt']) {
    assert.equal(can('seller', 'update', 'contactMessages', ['status', field]), false, field);
  }
  assert.equal(can('seller', 'update', 'contactMessages'), false, 'no field list is denied');
  assert.deepEqual([...SELLER_CONTACT_FIELDS], ['status', 'replies']);
  for (const actor of ['seller', 'admin', 'public'] as const) assert.equal(can(actor, 'delete', 'contactMessages'), false, actor);
  assert.equal(can('system', 'delete', 'contactMessages'), true);
});

test('contactMessages: the admin reads and nothing else; the public has no row', () => {
  assert.equal(can('admin', 'read', 'contactMessages'), true);
  assert.equal(can('admin', 'update', 'contactMessages', ['status']), false);
  for (const op of ['read', 'create', 'update', 'delete'] as const) assert.equal(can('public', op, 'contactMessages', ['status']), false, op);
});

test('tickets: a seller reads, creates and answers; the listed fields only', () => {
  assert.equal(can('seller', 'read', 'tickets'), true);
  assert.equal(can('seller', 'create', 'tickets', ['subject', 'messages', 'store', 'orderRef']), true);
  assert.equal(can('seller', 'update', 'tickets', ['messages', 'status']), true);
  for (const field of ['seller', 'revision', 'createdAt', 'subject', '_id']) assert.equal(can('seller', 'update', 'tickets', [field]), false, 'update ' + field);
  for (const field of ['seller', 'revision', 'createdAt', '_id']) assert.equal(can('seller', 'create', 'tickets', ['subject', field]), false, 'create ' + field);
  assert.equal(can('seller', 'create', 'tickets'), false);
  assert.equal(can('seller', 'delete', 'tickets'), false);
  assert.deepEqual([...SELLER_TICKET_FIELDS].sort(), ['messages', 'orderRef', 'status', 'store', 'subject']);
});

test('tickets: the admin reads and updates messages and status only, never creates or deletes', () => {
  assert.equal(can('admin', 'read', 'tickets'), true);
  assert.equal(can('admin', 'update', 'tickets', ['messages', 'status']), true);
  assert.equal(can('admin', 'update', 'tickets', ['subject']), false);
  assert.equal(can('admin', 'update', 'tickets', ['seller']), false);
  assert.equal(can('admin', 'create', 'tickets', ['subject']), false);
  assert.equal(can('admin', 'delete', 'tickets'), false);
});

test('tickets: the system may do everything (the retention purge); the public nothing', () => {
  for (const op of ['read', 'create', 'update', 'delete'] as const) {
    assert.equal(can('system', op, 'tickets', ['seller', 'revision']), true, op);
    assert.equal(can('public', op, 'tickets', ['subject']), false, op);
  }
});
