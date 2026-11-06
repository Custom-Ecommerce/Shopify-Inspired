
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorySchema } from '../src/category';
import { reviewSchema } from '../src/review';
import { STOCK_STATUSES } from '../src/stock-status';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';
const OID = '65a000000000000000000009';

test('a category parses', () => {
  const cat = { id: OID, name: 'Tops', slug: 'tops', createdAt: NOW, updatedAt: NOW };
  assert.equal(categorySchema.safeParse(cat).success, true);
});

test('a category without a slug is reported against slug', () => {
  const cat = { id: OID, name: 'Tops', createdAt: NOW, updatedAt: NOW };
  assert.deepEqual(failingPaths(categorySchema.safeParse(cat)), ['slug']);
});

test('a review rating outside one to five is reported against rating', () => {
  const review = { id: OID, product: OID, store: OID, rating: 6, body: 'Good', createdAt: NOW, updatedAt: NOW };
  assert.deepEqual(failingPaths(reviewSchema.safeParse(review)), ['rating']);
});

test('the stock status set is the three Payload options', () => {
  assert.deepEqual([...STOCK_STATUSES], ['in_stock', 'low_stock', 'out_of_stock']);
});
