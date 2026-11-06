import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_CATEGORY_SLUG_PATTERN,
  adminCategoryCreateRequestSchema,
  adminCategoryDeleteResponseSchema,
  adminCategoryListSchema,
  adminCategoryResponseSchema,
  adminCategoryUpdateRequestSchema,
} from '../src/admin-catalogue';

const OID = '65a000000000000000000001';
const NOW = '2026-10-11T10:00:00.000Z';
const meta = { totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };
const category = { id: OID, name: 'Lawn', slug: 'lawn', order: 2, description: null, createdAt: NOW, updatedAt: NOW };

test('a category page parses, and _id is refused', () => {
  assert.equal(adminCategoryListSchema.safeParse({ docs: [category], ...meta }).success, true);
  assert.equal(adminCategoryListSchema.safeParse({ docs: [{ ...category, id: undefined, _id: OID }], ...meta }).success, false);
  assert.equal(adminCategoryResponseSchema.safeParse({ category }).success, true);
});

test('create needs a name; slug, order, and description are optional', () => {
  assert.equal(adminCategoryCreateRequestSchema.safeParse({ name: 'Lawn' }).success, true);
  assert.equal(adminCategoryCreateRequestSchema.safeParse({ name: 'Lawn', slug: 'lawn-2', order: 0, description: null }).success, true);
  assert.equal(adminCategoryCreateRequestSchema.safeParse({}).success, false);
  assert.equal(adminCategoryCreateRequestSchema.safeParse({ name: '   ' }).success, false);
});

test('create refuses a bad slug, a bad order, a long description, and unknown fields', () => {
  const bad: unknown[] = [
    { name: 'A', slug: 'Has Space' },
    { name: 'A', slug: 'double--hyphen' },
    { name: 'A', slug: '-lead' },
    { name: 'A', order: -1 },
    { name: 'A', order: 1.5 },
    { name: 'A', order: 10000 },
    { name: 'A', description: 'x'.repeat(501) },
    { name: 'A', _id: OID },
  ];
  for (const body of bad) assert.equal(adminCategoryCreateRequestSchema.safeParse(body).success, false, JSON.stringify(body));
});

test('update needs at least one field and refuses unknown fields', () => {
  assert.equal(adminCategoryUpdateRequestSchema.safeParse({}).success, false);
  assert.equal(adminCategoryUpdateRequestSchema.safeParse({ order: 3 }).success, true);
  assert.equal(adminCategoryUpdateRequestSchema.safeParse({ description: null }).success, true);
  assert.equal(adminCategoryUpdateRequestSchema.safeParse({ createdAt: NOW }).success, false);
});

test('the slug pattern and the delete answer', () => {
  assert.equal(ADMIN_CATEGORY_SLUG_PATTERN.test('summer-2026'), true);
  assert.equal(ADMIN_CATEGORY_SLUG_PATTERN.test('Summer'), false);
  assert.equal(adminCategoryDeleteResponseSchema.safeParse({ deleted: true, id: OID }).success, true);
  assert.equal(adminCategoryDeleteResponseSchema.safeParse({ deleted: false, id: OID }).success, false);
});
