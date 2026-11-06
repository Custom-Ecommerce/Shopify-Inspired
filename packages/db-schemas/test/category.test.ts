import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Category } from '../src';

// These tests validate documents in memory. No database connection is needed.

const oid = () => new mongoose.Types.ObjectId();

test('a category needs a store', () => {
  const error = new Category({ name: 'Lawn', slug: 'lawn' }).validateSync();
  assert.ok(error?.errors.store);
});

test('a category with a store is valid, and isDemo defaults to false', () => {
  const category = new Category({ store: oid(), name: 'Lawn', slug: 'lawn' });
  assert.equal(category.validateSync(), undefined);
  assert.equal(category.isDemo, false);
  assert.equal(category.order, 0);
});

test('store references Store and banner references Media', () => {
  assert.equal(Category.schema.path('store').options.ref, 'Store');
  assert.equal(Category.schema.path('banner').options.ref, 'Media');
});

test('a slug is unique per store, and no index makes it unique across the platform', () => {
  const indexes = Category.schema.indexes();
  const unique = indexes.filter(([, options]) => options?.unique === true);
  assert.deepEqual(unique.map(([fields]) => fields), [{ store: 1, slug: 1 }]);
  assert.equal(indexes.some(([fields]) => Object.keys(fields)[0] === 'slug'), false);
  assert.equal(Category.schema.path('slug').options.unique, undefined);
});

test('every category index starts with the store, so store queries are indexed', () => {
  for (const [fields] of Category.schema.indexes()) assert.equal(Object.keys(fields)[0], 'store');
});
