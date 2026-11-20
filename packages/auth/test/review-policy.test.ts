import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';

// Sprint 5 EP-21 and EP-28 (D-107, D-108): the policy rows of reviews (the seller keeps only the reply; the admin hides and shows; the public route acts
// as the system actor) and of abandoned carts (the checkout writes as the system actor; the owner reads, marks contacted and deletes).

test('reviews: a seller reads, and updates the reply ONLY; the status, the text, the rating, the hide fields and the verified flag are denied', () => {
  assert.equal(can('seller', 'read', 'reviews'), true);
  assert.equal(can('seller', 'update', 'reviews', ['reply']), true);
  for (const field of ['status', 'body', 'rating', 'title', 'displayName', 'verified', 'hiddenReason', 'hiddenAt', 'hiddenBy', 'store', 'order', 'product']) {
    assert.equal(can('seller', 'update', 'reviews', [field]), false, field);
    assert.equal(can('seller', 'update', 'reviews', ['reply', field]), false, 'reply + ' + field);
  }
  assert.equal(can('seller', 'update', 'reviews'), false, 'no field list is denied');
  for (const operation of ['create', 'delete'] as const) assert.equal(can('seller', operation, 'reviews', ['body']), false, operation);
});

test('reviews: an admin may hide and show (status, hiddenReason, hiddenAt, hiddenBy); only the system creates one (the public review route); the public cannot', () => {
  assert.equal(can('admin', 'update', 'reviews', ['status', 'hiddenReason', 'hiddenAt', 'hiddenBy']), true);
  assert.equal(can('admin', 'read', 'reviews'), true);
  assert.equal(can('system', 'create', 'reviews', ['product', 'store', 'order', 'rating', 'title', 'body', 'displayName', 'verified', 'status']), true);
  assert.equal(can('public', 'create', 'reviews', ['body']), false);
  assert.equal(can('seller', 'create', 'reviews', ['body']), false);
  assert.equal(can('admin', 'create', 'reviews', ['body']), false);
  assert.equal(can('public', 'read', 'reviews'), false);
  assert.equal(can('public', 'update', 'reviews', ['status']), false);
});

test('abandonedCarts: the system creates and refreshes one (the public checkout route), nobody else does', () => {
  assert.equal(can('system', 'create', 'abandonedCarts', ['store', 'phone', 'email', 'items', 'total', 'status', 'consentAt', 'lastSeenAt', 'expiresAt']), true);
  assert.equal(can('system', 'update', 'abandonedCarts', ['items', 'total', 'lastSeenAt', 'expiresAt']), true);
  assert.equal(can('system', 'update', 'abandonedCarts', ['status', 'recoveredOrder', 'recoveredAt']), true);
  for (const actor of ['seller', 'public', 'admin'] as const) assert.equal(can(actor, 'create', 'abandonedCarts', ['phone']), false, actor);
});

test('abandonedCarts: the owner reads, moves a cart to contacted (the status field only) and deletes it; an admin and the public have no row', () => {
  assert.equal(can('seller', 'read', 'abandonedCarts'), true);
  assert.equal(can('seller', 'update', 'abandonedCarts', ['status']), true);
  for (const field of ['phone', 'email', 'items', 'total', 'consentAt', 'lastSeenAt', 'expiresAt', 'recoveredOrder', 'store']) {
    assert.equal(can('seller', 'update', 'abandonedCarts', [field]), false, field);
    assert.equal(can('seller', 'update', 'abandonedCarts', ['status', field]), false, 'status + ' + field);
  }
  assert.equal(can('seller', 'delete', 'abandonedCarts'), true);
  for (const actor of ['admin', 'public'] as const) {
    for (const operation of ['read', 'create', 'update', 'delete'] as const) assert.equal(can(actor, operation, 'abandonedCarts', ['status']), false, actor + ' ' + operation);
  }
});
