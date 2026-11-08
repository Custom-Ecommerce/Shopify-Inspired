import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORE_SLUG_MAX_LENGTH, STORE_SLUG_MIN_LENGTH, checkStoreSlug } from '@markaz/platform-kit/reservation';
import { slugWithSuffix, slugify } from '../src/lib/workspace';

const LONG_NAME = 'The Very Long Named Lahore Embroidered Lawn And Chiffon House';

test('a generated slug never passes the platform limit, and never ends on a hyphen', () => {
  const slug = slugify(LONG_NAME);
  assert.ok(slug.length <= STORE_SLUG_MAX_LENGTH);
  assert.equal(checkStoreSlug(slug).ok, true);
  assert.equal(slugify('a'.repeat(29) + ' b c').endsWith('-'), false);
});

test('the retry after a taken slug stays inside the limit, even from a base at the limit', () => {
  const base = slugify(LONG_NAME);
  const retried = slugWithSuffix(base, 'x7k2');
  assert.ok(retried.length <= STORE_SLUG_MAX_LENGTH);
  assert.ok(retried.endsWith('-x7k2'));
  assert.equal(checkStoreSlug(retried).ok, true);
  assert.ok(slugWithSuffix('a'.repeat(25) + '-bcd', 'toolongsuffix').length <= STORE_SLUG_MAX_LENGTH);
  assert.equal(slugWithSuffix('a'.repeat(24) + '-bcd', 'x7k2').includes('--'), false);
});

test('a name too short for a slug falls back to one the storefront accepts', () => {
  assert.equal(slugify('ab'), 'store');
  assert.ok(slugify('ab').length >= STORE_SLUG_MIN_LENGTH);
});
