
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productSchema } from '../src/product';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: '65a000000000000000000003',
    store: '65a000000000000000000001',
    title: 'Shirt',
    slug: 'shirt',
    categories: [{ id: '65a000000000000000000004', name: 'Tops' }],
    media: [{ id: '65a000000000000000000008', url: 'https://cdn.example.com/a.jpg' }],
    highlights: [{ text: 'Cotton' }],
    price: 2500,
    originalPrice: 3000,
    stockStatus: 'in_stock',
    stockQuantity: 12,
    stockHistory: [{ quantity: 12, previousQuantity: 10, reason: 'restock', changedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('a populated product, as the dashboard reads it, parses', () => {
  assert.equal(productSchema.safeParse(product()).success, true);
});

test('the wire identity is id, not _id', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ id: 'nope' }))), ['id']);
});

test('a negative price is reported against price', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ price: -1 }))), ['price']);
});

test('an unknown stock status is reported against stockStatus', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ stockStatus: 'maybe' }))), ['stockStatus']);
});

test('highlights are rows with text, so plain strings are rejected', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ highlights: ['Cotton'] }))), ['highlights.0']);
});

test('an unpopulated ObjectId relation is also accepted', () => {
  const ids = product({ categories: ['65a000000000000000000004'], media: ['65a000000000000000000008'] });
  assert.equal(productSchema.safeParse(ids).success, true);
});
