
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEnvelope } from '../src/envelope';

test('an envelope reports pages, next and previous flags', () => {
  const env = listEnvelope(['a', 'b'], { page: 2, limit: 2, totalDocs: 5 });
  assert.deepEqual(env, {
    docs: ['a', 'b'],
    totalDocs: 5,
    totalPages: 3,
    page: 2,
    limit: 2,
    hasNextPage: true,
    hasPrevPage: true,
  });
});

test('the last page has no next page', () => {
  const env = listEnvelope(['e'], { page: 3, limit: 2, totalDocs: 5 });
  assert.equal(env.hasNextPage, false);
  assert.equal(env.hasPrevPage, true);
});

test('an empty result has zero pages and no neighbours', () => {
  const env = listEnvelope([], { page: 1, limit: 10, totalDocs: 0 });
  assert.equal(env.totalPages, 0);
  assert.equal(env.hasNextPage, false);
  assert.equal(env.hasPrevPage, false);
});

test('page must be a positive integer', () => {
  assert.throws(() => listEnvelope([], { page: 0, limit: 10, totalDocs: 0 }), /page must be a positive integer/);
});

test('limit must be a positive integer', () => {
  assert.throws(() => listEnvelope([], { page: 1, limit: 1.5, totalDocs: 0 }), /limit must be a positive integer/);
});

test('totalDocs must be non-negative', () => {
  assert.throws(() => listEnvelope([], { page: 1, limit: 10, totalDocs: -1 }), /totalDocs must be/);
});
