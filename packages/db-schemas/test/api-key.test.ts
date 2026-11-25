import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiKey, API_KEY_MODEL_SCOPES } from '../src';

// Sprint 8 (S8-B4, D-118): the ApiKey model. Validation, defaults and indexes only: no database.

const key = {
  store: '65a000000000000000000011',
  name: 'Accounting sync',
  prefix: '0a1b2c3d',
  hash: 'a'.repeat(64),
  scopes: ['products:read'],
  createdBy: '65a000000000000000000001',
};

test('a key needs its store, name, prefix, hash, scopes and author; it starts unused, not revoked, at revision 0', () => {
  const row = new ApiKey(key);
  assert.equal(row.validateSync(), undefined);
  assert.equal(row.lastUsedAt, null);
  assert.equal(row.revokedAt, null);
  assert.equal(row.revision, 0);
  for (const field of ['store', 'name', 'prefix', 'hash', 'createdBy'] as const) {
    const { [field]: _omitted, ...rest } = key;
    void _omitted;
    assert.ok(new ApiKey(rest).validateSync()?.errors[field], field);
  }
});

test('the name is at most 40 characters; the prefix is 8 hex characters; the hash is a SHA-256 hex', () => {
  assert.equal(new ApiKey({ ...key, name: 'x'.repeat(40) }).validateSync(), undefined);
  assert.ok(new ApiKey({ ...key, name: 'x'.repeat(41) }).validateSync()?.errors.name);
  for (const prefix of ['0a1b2c3', '0a1b2c3d4', 'ZZZZZZZZ', '0A1B2C3D']) assert.ok(new ApiKey({ ...key, prefix }).validateSync()?.errors.prefix, prefix);
  for (const hash of ['abc', 'g'.repeat(64), 'a'.repeat(63)]) assert.ok(new ApiKey({ ...key, hash }).validateSync()?.errors.hash, hash);
});

test('the scopes are products:read and orders:read only, at least one, none twice', () => {
  assert.deepEqual([...API_KEY_MODEL_SCOPES], ['products:read', 'orders:read']);
  assert.equal(new ApiKey({ ...key, scopes: ['products:read', 'orders:read'] }).validateSync(), undefined);
  for (const scopes of [[], ['products:write'], ['orders:read', 'orders:read'], ['*']]) assert.ok(new ApiKey({ ...key, scopes }).validateSync(), JSON.stringify(scopes));
});

test('the secret hash is never selected by default, and there is no field for the secret itself', () => {
  assert.equal((ApiKey.schema.path('hash') as unknown as { options: { select?: boolean } }).options.select, false);
  for (const path of ['secret', 'key', 'token']) assert.equal(ApiKey.schema.path(path), undefined, path);
});

test('the indexes: a unique prefix, and {store, revokedAt}; the collection is apikeys', () => {
  const indexes = ApiKey.schema.indexes() as Array<[Record<string, number>, Record<string, any>]>;
  const prefix = indexes.find(([, options]) => options?.name === 'prefix_unique');
  assert.deepEqual(prefix?.[0], { prefix: 1 });
  assert.equal(prefix?.[1].unique, true);
  const live = indexes.find(([, options]) => options?.name === 'store_revokedAt');
  assert.deepEqual(live?.[0], { store: 1, revokedAt: 1 });
  assert.notEqual(live?.[1].unique, true);
  assert.equal(indexes.filter(([, options]) => options?.unique === true).length, 1);
  assert.equal(ApiKey.collection.name, 'apikeys');
});
