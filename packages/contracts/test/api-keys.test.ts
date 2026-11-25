import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_KEY_NAME_MAX,
  API_KEY_SCOPES,
  apiKeyCreateRequestSchema,
  apiKeyCreateResponseSchema,
  apiKeyListResponseSchema,
  apiKeySchema,
} from '../src/api-keys';
import { failingPaths } from './helpers';

// Sprint 8 (S8-B4, D-118): the API key contracts. Strict bodies; no list answer has a field for a secret or a hash.

const view = { id: '65a000000000000000000011', name: 'Sync', prefix: 'mkz_live_0a1b2c3d', scopes: ['products:read'], lastUsedAt: null, createdAt: '2026-11-25T10:00:00.000Z', revokedAt: null };

test('the scopes are products:read and orders:read only, and the name is at most 40 characters', () => {
  assert.deepEqual([...API_KEY_SCOPES], ['products:read', 'orders:read']);
  assert.equal(API_KEY_NAME_MAX, 40);
});

test('a create body is a name and at least one scope, each once; the name is cleaned', () => {
  const ok = apiKeyCreateRequestSchema.safeParse({ name: '  Accounting\n  sync ', scopes: ['orders:read', 'products:read'] });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.name, 'Accounting sync');
  const bad: Array<[unknown, string]> = [
    [{ scopes: ['products:read'] }, 'name'],
    [{ name: '', scopes: ['products:read'] }, 'name'],
    [{ name: '   ', scopes: ['products:read'] }, 'name'],
    [{ name: 'x'.repeat(41), scopes: ['products:read'] }, 'name'],
    [{ name: '<b>x</b>', scopes: ['products:read'] }, 'name'],
    [{ name: 'a' }, 'scopes'],
    [{ name: 'a', scopes: [] }, 'scopes'],
    [{ name: 'a', scopes: ['products:write'] }, 'scopes.0'],
    [{ name: 'a', scopes: ['orders:read', 'orders:read'] }, 'scopes'],
  ];
  for (const [body, field] of bad) {
    const result = apiKeyCreateRequestSchema.safeParse(body);
    assert.equal(result.success, false, JSON.stringify(body));
    assert.ok(failingPaths(result).includes(field), JSON.stringify(body) + ' -> ' + failingPaths(result).join(','));
  }
});

test('the create body is strict: a store, a prefix, a hash, a secret or an expiry is refused', () => {
  for (const key of ['store', 'prefix', 'hash', 'secret', 'revokedAt', 'expiresAt']) {
    assert.equal(apiKeyCreateRequestSchema.safeParse({ name: 'a', scopes: ['products:read'], [key]: 'x' }).success, false, key);
  }
});

test('a key view is strict: a hash or a secret added by mistake fails the parse, in the view and in the list', () => {
  assert.equal(apiKeySchema.safeParse(view).success, true);
  for (const extra of [{ hash: 'a'.repeat(64) }, { secret: 'x' }, { token: 'x' }]) {
    assert.equal(apiKeySchema.safeParse({ ...view, ...extra }).success, false, Object.keys(extra)[0]);
    assert.equal(apiKeyListResponseSchema.safeParse({ keys: [{ ...view, ...extra }], usage: { used: 1, limit: 2 } }).success, false);
  }
  assert.equal(apiKeyListResponseSchema.safeParse({ keys: [view], usage: { used: 1, limit: null } }).success, true);
  assert.equal(apiKeyListResponseSchema.safeParse({ keys: [view], usage: { used: 1, limit: 2 }, secret: 'x' }).success, false);
});

test('only the create answer carries the secret', () => {
  assert.equal(apiKeyCreateResponseSchema.safeParse({ key: view, secret: 'mkz_live_0a1b2c3d_x' }).success, true);
  assert.equal(apiKeyCreateResponseSchema.safeParse({ key: view }).success, false);
});
