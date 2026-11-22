import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';
import { SELLER_PAGE_FIELDS } from '../src/policy';

// Sprint 7 (S7-B3): the storePages policy row. A seller writes their own store's pages through an explicit field list; nobody else gains anything.

const WRITE_FIELDS = ['title', 'slug', 'body', 'status', 'showInFooter', 'sortOrder'];
const SERVER_FIELDS = ['store', 'revision', 'mediaRefs', 'template', 'publishedAt', 'createdAt', 'updatedAt', '_id', 'id', 'owner'];

test('the seller field list is exactly the contract\'s write fields', () => {
  assert.deepEqual([...SELLER_PAGE_FIELDS], WRITE_FIELDS);
});

test('seller: create and update with the listed fields, singly or together', () => {
  for (const op of ['create', 'update'] as const) {
    assert.equal(can('seller', op, 'storePages', WRITE_FIELDS), true, op);
    for (const field of WRITE_FIELDS) assert.equal(can('seller', op, 'storePages', [field]), true, op + ' ' + field);
  }
});

test('seller: any other field is refused, alone or among good ones, and so is an empty or missing list', () => {
  for (const op of ['create', 'update'] as const) {
    for (const field of SERVER_FIELDS) {
      assert.equal(can('seller', op, 'storePages', [field]), false, op + ' ' + field);
      assert.equal(can('seller', op, 'storePages', ['title', field]), false, op + ' title+' + field);
    }
    assert.equal(can('seller', op, 'storePages'), false);
    assert.equal(can('seller', op, 'storePages', []), false);
  }
});

test('seller: read and delete', () => {
  assert.equal(can('seller', 'read', 'storePages'), true);
  assert.equal(can('seller', 'delete', 'storePages'), true);
});

test('admin: reads only', () => {
  assert.equal(can('admin', 'read', 'storePages'), true);
  assert.equal(can('admin', 'create', 'storePages', ['title']), false);
  assert.equal(can('admin', 'update', 'storePages', ['title']), false);
  assert.equal(can('admin', 'delete', 'storePages'), false);
});

test('system: every operation, every field', () => {
  for (const op of ['read', 'create', 'update', 'delete'] as const) assert.equal(can('system', op, 'storePages', ['store', 'revision', 'mediaRefs']), true, op);
});

test('public: nothing (the storefront reads pages through the seller backend\'s public route, never the policy)', () => {
  for (const op of ['read', 'create', 'update', 'delete'] as const) assert.equal(can('public', op, 'storePages', ['title']), false, op);
});
