
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeArticleSchema } from '../src/store-article';
import { failingPaths } from './helpers';

const OID = '65a000000000000000000006';
const NOW = '2026-10-01T00:00:00.000Z';

function validArticle(overrides: Record<string, unknown> = {}) {
  return {
    id: OID,
    store: '65a000000000000000000001',
    title: 'Care guide',
    slug: 'care-guide',
    excerpt: 'How to wash',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('a store article parses', () => {
  assert.equal(storeArticleSchema.safeParse(validArticle()).success, true);
});

test('an excerpt over 160 characters is reported against excerpt', () => {
  assert.deepEqual(
    failingPaths(storeArticleSchema.safeParse(validArticle({ excerpt: 'x'.repeat(161) }))),
    ['excerpt'],
  );
});

test('a missing slug is reported against slug', () => {
  const { slug: _omit, ...rest } = validArticle();
  assert.deepEqual(failingPaths(storeArticleSchema.safeParse(rest)), ['slug']);
});
