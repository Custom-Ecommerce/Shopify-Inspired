import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';
import { SELLER_ARTICLE_FIELDS } from '../src/policy';

// Sprint 7 (S7-B2, CO-116): the storeArticles policy row. A seller writes the articles of their own store through an explicit field list; nobody else
// gains anything.

const WRITE_FIELDS = ['type', 'title', 'slug', 'excerpt', 'content', 'coverImage', 'status', 'tags', 'seoTitle', 'seoDescription'];
const SERVER_FIELDS = ['store', 'publishedAt', 'revision', 'mediaRefs', 'createdAt', 'updatedAt', '_id', 'id', 'owner'];

test('the seller field list is exactly the contract\'s write fields', () => {
  assert.deepEqual([...SELLER_ARTICLE_FIELDS], WRITE_FIELDS);
});

test('seller: create and update with the listed fields, singly or together', () => {
  for (const op of ['create', 'update'] as const) {
    assert.equal(can('seller', op, 'storeArticles', WRITE_FIELDS), true, op);
    for (const field of WRITE_FIELDS) assert.equal(can('seller', op, 'storeArticles', [field]), true, op + ' ' + field);
  }
});

test('seller: any field outside the list is refused, alone or among good ones, and so is an empty or missing list', () => {
  for (const op of ['create', 'update'] as const) {
    for (const field of SERVER_FIELDS) {
      assert.equal(can('seller', op, 'storeArticles', [field]), false, op + ' ' + field);
      assert.equal(can('seller', op, 'storeArticles', ['title', field]), false, op + ' title+' + field);
    }
    assert.equal(can('seller', op, 'storeArticles'), false, op + ' without a field list');
    assert.equal(can('seller', op, 'storeArticles', []), false, op + ' with an empty list');
  }
});

test('seller: read and delete', () => {
  assert.equal(can('seller', 'read', 'storeArticles'), true);
  assert.equal(can('seller', 'delete', 'storeArticles'), true);
});

test('admin: reads, updates and deletes any field as before, and still cannot create', () => {
  assert.equal(can('admin', 'read', 'storeArticles'), true);
  assert.equal(can('admin', 'update', 'storeArticles', ['status', 'publishedAt']), true);
  assert.equal(can('admin', 'delete', 'storeArticles'), true);
  assert.equal(can('admin', 'create', 'storeArticles', ['title']), false);
});

test('system: every operation, every field', () => {
  for (const op of ['read', 'create', 'update', 'delete'] as const) assert.equal(can('system', op, 'storeArticles', ['store', 'revision', 'mediaRefs']), true, op);
});

test('public: nothing (the storefront reads articles through the seller backend\'s public route, never the policy)', () => {
  for (const op of ['read', 'create', 'update', 'delete'] as const) assert.equal(can('public', op, 'storeArticles', ['title']), false, op);
});
