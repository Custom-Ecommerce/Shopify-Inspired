import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSchema } from '../src/review';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';
const OID = '65a000000000000000000009';

function review(overrides: Record<string, unknown> = {}) {
  return { id: OID, product: OID, store: OID, rating: 4, body: 'Good', createdAt: NOW, updatedAt: NOW, ...overrides };
}

test('a review with a populated product, as the reviews page reads it, parses', () => {
  const populated = review({ product: { id: OID, title: 'Shirt', slug: 'shirt' } });
  assert.equal(reviewSchema.safeParse(populated).success, true);
});

test('a product that is neither an id nor a populated product is reported against product', () => {
  const paths = failingPaths(reviewSchema.safeParse(review({ product: { title: 'Shirt' } })));
  assert.ok(paths.length > 0);
  assert.ok(paths.every((p) => p === 'product' || p.startsWith('product.')), 'paths: ' + paths.join(','));
});
