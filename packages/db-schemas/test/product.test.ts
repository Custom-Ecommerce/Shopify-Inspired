import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Product } from '../src';

// These tests validate documents in memory. No database connection is needed.

const oid = () => new mongoose.Types.ObjectId();

function product(overrides: Record<string, unknown> = {}) {
  return new Product({
    store: oid(),
    title: 'Blue shirt',
    slug: 'Blue-Shirt',
    categories: [oid()],
    price: 1500,
    ...overrides,
  });
}

test('product accepts a minimal valid document and applies defaults', () => {
  const doc = product();
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.stockStatus, 'in_stock');
  assert.equal(doc.stockQuantity, 0);
  assert.equal(doc.isPublished, true);
  assert.equal(doc.avgRating, 0);
  assert.equal(doc.reviewCount, 0);
  assert.equal(doc.originalPrice, null);
});

test('product slug is trimmed and lowercased', () => {
  assert.equal(product({ slug: '  Blue-Shirt ' }).slug, 'blue-shirt');
});

test('product requires store, title, slug and price', () => {
  for (const missing of ['store', 'title', 'slug', 'price']) {
    const doc = product({ [missing]: undefined });
    assert.notEqual(doc.validateSync(), undefined, missing + ' should be required');
  }
});

test('product needs at least one category', () => {
  assert.notEqual(product({ categories: [] }).validateSync(), undefined);
});

test('product rejects negative prices and an unknown stock status', () => {
  assert.notEqual(product({ price: -1 }).validateSync(), undefined);
  assert.notEqual(product({ originalPrice: -5 }).validateSync(), undefined);
  assert.notEqual(product({ stockStatus: 'gone' }).validateSync(), undefined);
});

test('product stock quantity must be a whole, non-negative number', () => {
  assert.notEqual(product({ stockQuantity: 1.5 }).validateSync(), undefined);
  assert.notEqual(product({ stockQuantity: -1 }).validateSync(), undefined);
  assert.equal(product({ stockQuantity: 12 }).validateSync(), undefined);
});

test('product rating is bounded to 0..5', () => {
  assert.notEqual(product({ avgRating: 5.5 }).validateSync(), undefined);
});

test('product references Category and Media', () => {
  assert.equal((Product.schema.path('categories') as any).caster.options.ref, 'Category');
  assert.equal((Product.schema.path('media') as any).caster.options.ref, 'Media');
});

test('product slug is unique per store, and catalog indexes lead with store', () => {
  const indexes = Product.schema.indexes();
  const unique = indexes.find(([fields]) => 'slug' in fields && 'store' in fields);
  assert.ok(unique, 'store+slug index exists');
  assert.equal(unique[1].unique, true);
  for (const [fields] of indexes) assert.equal(Object.keys(fields)[0], 'store');
});

test('product uses the products collection', () => {
  assert.equal(Product.collection.name, 'products');
});
