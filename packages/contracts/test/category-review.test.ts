
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_SLUG_MAX,
  CATEGORY_SLUG_PATTERN,
  categoryCreateRequestSchema,
  categorySchema,
  categoryUpdateRequestSchema,
} from '../src/category';
import { STOREFRONT_CATEGORY_SLUG_PATTERN, storefrontCategoryListResponseSchema } from '../src/storefront';
import { reviewSchema } from '../src/review';
import { STOCK_STATUSES } from '../src/stock-status';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';
const OID = '65a000000000000000000009';

test('a category parses', () => {
  const cat = { id: OID, store: OID, name: 'Tops', slug: 'tops', isDemo: false, createdAt: NOW, updatedAt: NOW };
  assert.equal(categorySchema.safeParse(cat).success, true);
});

test('a category without a slug is reported against slug', () => {
  const cat = { id: OID, store: OID, name: 'Tops', isDemo: false, createdAt: NOW, updatedAt: NOW };
  assert.deepEqual(failingPaths(categorySchema.safeParse(cat)), ['slug']);
});

test('a category without a store is reported against store', () => {
  const cat = { id: OID, name: 'Tops', slug: 'tops', isDemo: false, createdAt: NOW, updatedAt: NOW };
  assert.deepEqual(failingPaths(categorySchema.safeParse(cat)), ['store']);
});

test('create needs a name; slug, order, and description are optional', () => {
  assert.equal(categoryCreateRequestSchema.safeParse({ name: 'Lawn' }).success, true);
  assert.equal(categoryCreateRequestSchema.safeParse({ name: 'Lawn', slug: 'lawn-2', order: 0, description: null }).success, true);
  assert.equal(categoryCreateRequestSchema.safeParse({}).success, false);
  assert.equal(categoryCreateRequestSchema.safeParse({ name: '   ' }).success, false);
});

test('create refuses a bad slug, a bad order, a long description, and every field a seller may not set', () => {
  const bad = [
    { name: 'Lawn', slug: 'Lawn' },
    { name: 'Lawn', slug: 'a--b' },
    { name: 'Lawn', slug: 'x'.repeat(CATEGORY_SLUG_MAX + 1) },
    { name: 'Lawn', order: -1 },
    { name: 'Lawn', order: 1.5 },
    { name: 'Lawn', order: 10000 },
    { name: 'Lawn', description: 'x'.repeat(501) },
    { name: 'Lawn', store: OID },
    { name: 'Lawn', storeId: OID },
    { name: 'Lawn', isDemo: true },
    { name: 'Lawn', banner: OID },
  ];
  for (const body of bad) assert.equal(categoryCreateRequestSchema.safeParse(body).success, false, JSON.stringify(body));
});

test('update needs at least one field and refuses unknown fields', () => {
  assert.equal(categoryUpdateRequestSchema.safeParse({}).success, false);
  assert.equal(categoryUpdateRequestSchema.safeParse({ order: 3 }).success, true);
  assert.equal(categoryUpdateRequestSchema.safeParse({ description: null }).success, true);
  assert.equal(categoryUpdateRequestSchema.safeParse({ createdAt: NOW }).success, false);
  assert.equal(categoryUpdateRequestSchema.safeParse({ store: OID }).success, false);
});

test('every slug a seller may save is one the storefront accepts', () => {
  const longest = 'a'.repeat(CATEGORY_SLUG_MAX);
  assert.equal(CATEGORY_SLUG_PATTERN.test(longest), true);
  assert.equal(STOREFRONT_CATEGORY_SLUG_PATTERN.test(longest), true);
  assert.equal(STOREFRONT_CATEGORY_SLUG_PATTERN.test(longest + 'a'), false);
  assert.equal(CATEGORY_SLUG_PATTERN.test('summer-2026'), true);
  assert.equal(CATEGORY_SLUG_PATTERN.test('Summer'), false);
});

test('the storefront category list has the public shape', () => {
  const category = { id: OID, name: 'Tops', slug: 'tops', order: 1, description: null, bannerUrl: null };
  assert.equal(storefrontCategoryListResponseSchema.safeParse({ data: [category] }).success, true);
  assert.equal(storefrontCategoryListResponseSchema.safeParse({ data: [{ ...category, order: undefined }] }).success, false);
});

test('a review rating outside one to five is reported against rating', () => {
  const review = { id: OID, product: OID, store: OID, rating: 6, body: 'Good', createdAt: NOW, updatedAt: NOW };
  assert.deepEqual(failingPaths(reviewSchema.safeParse(review)), ['rating']);
});

test('the stock status set is the three Payload options', () => {
  assert.deepEqual([...STOCK_STATUSES], ['in_stock', 'low_stock', 'out_of_stock']);
});
