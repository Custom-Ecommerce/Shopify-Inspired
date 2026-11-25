import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_FORBIDDEN_BODY,
  API_UNAUTHORIZED_BODY,
  bearerKeyOf,
  checkApiKey,
  generateApiKey,
  hashApiSecret,
  parseApiKey,
  publicApiKeyPrefix,
  secretMatches,
  type ApiKeyRow,
} from '../src/lib/api-keys';
import { API_KEY_RATE_RULE, apiRateLimitedBody, limitApiKey } from '../src/lib/api-rate-limit';
import { useMemoryAuthLimits } from '../src/lib/account-support';

// Sprint 8 (S8-B4, D-118): the API key library and the per-key limit. Pure: no database (the limiter uses in-process counters).

const SHAPE = /^mkz_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

function stored(scopes: string[] = ['products:read'], extra: Partial<ApiKeyRow> = {}) {
  const generated = generateApiKey();
  const row: ApiKeyRow = { _id: 'k1', store: 's1', hash: generated.hash, scopes, revokedAt: null, ...extra };
  const lookups: string[] = [];
  const deps = {
    findByPrefix: async (prefix: string) => {
      lookups.push(prefix);
      return prefix === generated.prefix ? row : null;
    },
  };
  return { ...generated, row, deps, lookups, header: 'Bearer ' + generated.token };
}

test('a key is mkz_live_<8 hex>_<32 random bytes>; only the SHA-256 of the secret is kept; two keys never repeat', () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.match(a.token, SHAPE);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.hash, b.hash);
  const secret = a.token.slice('mkz_live_'.length + 9);
  assert.equal(secret.length, 43);
  assert.equal(Buffer.from(secret, 'base64url').length, 32);
  assert.equal(a.hash, createHash('sha256').update(secret).digest('hex'));
  assert.equal(a.hash.includes(secret), false);
  assert.equal(a.token.includes('mkz_live_' + a.prefix + '_'), true);
  assert.equal(publicApiKeyPrefix(a.prefix), 'mkz_live_' + a.prefix);
});

test('parseApiKey reads exactly a key and never throws, whatever it is given', () => {
  const { token, prefix } = generateApiKey();
  assert.equal(parseApiKey(token)?.prefix, prefix);
  const bad: unknown[] = [undefined, null, 1, {}, [], '', 'mkz_live_', token.slice(0, -1), token + 'a', ' ' + token, token.toUpperCase(), token.replace('mkz_live', 'mkz_test'), 'x'.repeat(100000), 'mkz_live_zzzzzzzz_' + 'a'.repeat(43)];
  for (const value of bad) assert.equal(parseApiKey(value), null, String(value).slice(0, 40));
  // A secret may itself contain _ and -: the fixed lengths keep the parse unambiguous.
  const odd = 'mkz_live_0a1b2c3d_' + '_-'.repeat(21) + 'a';
  assert.deepEqual(parseApiKey(odd), { prefix: '0a1b2c3d', secret: '_-'.repeat(21) + 'a' });
});

test('the Authorization header: "Bearer <key>" only', () => {
  assert.equal(bearerKeyOf('Bearer abc'), 'abc');
  assert.equal(bearerKeyOf('bearer   abc  '), 'abc');
  for (const bad of [undefined, null, '', 'abc', 'Basic abc', 'Bearer', 'Bearer ', 'Bearer a b', 'JWT abc', 'x'.repeat(1000)]) assert.equal(bearerKeyOf(bad), null, String(bad).slice(0, 20));
});

test('the secret comparison is over equal-length hashes: a wrong secret, a missing or a broken stored hash never match and never throw', () => {
  const hash = hashApiSecret('right');
  assert.equal(secretMatches('right', hash), true);
  assert.equal(secretMatches('wrong', hash), false);
  assert.equal(secretMatches('', hash), false);
  for (const broken of [undefined, null, '', 'abc', 'g'.repeat(64), hash.slice(0, 63), hash + 'a', 7]) assert.equal(secretMatches('right', broken), false, String(broken));
});

test('a good key with the scope passes: its id, store and scopes', async () => {
  const key = stored(['products:read', 'orders:read']);
  const result = await checkApiKey(key.header, 'orders:read', key.deps);
  assert.deepEqual(result, { ok: true, status: 200, key: { id: 'k1', storeId: 's1', scopes: ['products:read', 'orders:read'] } });
});

test('the scopes are enforced: a key without the scope is 403, and an unknown scope is never granted', async () => {
  const key = stored(['products:read']);
  assert.equal((await checkApiKey(key.header, 'products:read', key.deps)).status, 200);
  const refused = await checkApiKey(key.header, 'orders:read', key.deps);
  assert.equal(refused.status, 403);
  assert.deepEqual(!refused.ok && refused.body, API_FORBIDDEN_BODY);
  for (const scope of ['orders:write', '*', '']) assert.equal((await checkApiKey(key.header, scope, key.deps)).status, 403, scope);
  const odd = stored('products:read' as never);
  assert.equal((await checkApiKey(odd.header, 'products:read', odd.deps)).status, 403, 'scopes that are not a list grant nothing');
});

test('missing, malformed, unknown, wrong-secret and revoked keys all get the SAME 401 body, and each takes the same path: exactly one lookup', async () => {
  const good = stored();
  const other = generateApiKey();
  const wrongSecret = 'Bearer mkz_live_' + good.prefix + '_' + other.token.slice(-43);
  const revoked = stored(['products:read'], { revokedAt: new Date() });
  const cases: Array<[string, unknown, typeof good.deps, string[]]> = [
    ['no header', undefined, good.deps, good.lookups],
    ['empty', '', good.deps, good.lookups],
    ['not bearer', 'Basic zzz', good.deps, good.lookups],
    ['malformed', 'Bearer mkz_live_nonsense', good.deps, good.lookups],
    ['unknown prefix', 'Bearer ' + other.token, good.deps, good.lookups],
    ['wrong secret', wrongSecret, good.deps, good.lookups],
    ['revoked', revoked.header, revoked.deps, revoked.lookups],
  ];
  const bodies = new Set<string>();
  for (const [name, header, deps, lookups] of cases) {
    const before = lookups.length;
    const result = await checkApiKey(header, 'products:read', deps);
    assert.equal(result.status, 401, name);
    assert.equal(lookups.length - before, 1, name + ': one lookup');
    bodies.add(JSON.stringify(!result.ok && result.body));
  }
  assert.deepEqual([...bodies], [JSON.stringify(API_UNAUTHORIZED_BODY)]);
});

test('a revoked key fails the very next check; a revoked key is refused as 401 even when it lacks the scope', async () => {
  const key = stored();
  assert.equal((await checkApiKey(key.header, 'products:read', key.deps)).status, 200);
  key.row.revokedAt = new Date();
  assert.equal((await checkApiKey(key.header, 'products:read', key.deps)).status, 401);
  assert.equal((await checkApiKey(key.header, 'orders:read', key.deps)).status, 401, 'nothing is said about its scopes');
});

test('a database failure is thrown to the caller, never answered as an invalid key', async () => {
  const key = stored();
  await assert.rejects(checkApiKey(key.header, 'products:read', { findByPrefix: async () => { throw new Error('down'); } }), /down/);
});

test('no answer of a check carries the secret or its hash', async () => {
  const key = stored();
  const secret = key.token.slice(-43);
  for (const header of [key.header, 'Bearer ' + key.token + 'x', 'Bearer ' + generateApiKey().token]) {
    for (const scope of ['products:read', 'orders:read']) {
      const text = JSON.stringify(await checkApiKey(header, scope, key.deps));
      assert.equal(text.includes(secret), false);
      assert.equal(text.includes(key.hash), false);
    }
  }
});

test('the rate limit: 120 requests a minute per key, then 429 with Retry-After; another key and the next minute are free', async () => {
  useMemoryAuthLimits();
  assert.deepEqual(API_KEY_RATE_RULE, { name: 'api-key', limit: 120, windowMs: 60_000 });
  const now = 1_800_000_000_000 - (1_800_000_000_000 % 60_000) + 15_000;
  for (let i = 0; i < 120; i += 1) assert.equal(await limitApiKey('key-a', now), null, String(i));
  const limited = await limitApiKey('key-a', now);
  assert.equal(limited?.status, 429);
  assert.equal(limited!.headers.get('retry-after'), '45');
  assert.equal(limited!.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await limited!.json(), { error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait and try again.', retryAfterSeconds: 45 } });
  assert.equal(await limitApiKey('key-b', now), null, 'the limit is per key');
  assert.equal(await limitApiKey('key-a', now + 60_000), null, 'a new minute');
});

test('the counter of a key does not name the key', async () => {
  const memory = useMemoryAuthLimits() as unknown as Record<string, unknown>;
  const seen: string[] = [];
  const increment = (memory.increment as (key: string, at: Date) => Promise<number>).bind(memory);
  memory.increment = async (key: string, at: Date) => (seen.push(key), increment(key, at));
  await limitApiKey('65a000000000000000000099', 1_800_000_000_000);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.includes('65a000000000000000000099'), false);
});

test('docs/api-v1.md states the header, the scopes, the error bodies of this library, the rate limit and what is only planned', () => {
  // The tests of this workspace run with the workspace as the working directory.
  const docs = readFileSync(join(process.cwd(), '..', '..', '..', 'docs', 'api-v1.md'), 'utf8');
  assert.ok(docs.includes('Authorization: Bearer'));
  for (const scope of ['products:read', 'orders:read']) assert.ok(docs.includes(scope), scope);
  assert.ok(docs.includes(API_UNAUTHORIZED_BODY.error.message));
  assert.ok(docs.includes(API_FORBIDDEN_BODY.error.message));
  assert.ok(docs.includes(apiRateLimitedBody(1).error.message));
  assert.ok(docs.includes(API_KEY_RATE_RULE.limit + ' requests per minute'));
  assert.ok(docs.includes('Retry-After'));
  assert.match(docs, /read-only/);
  for (const path of ['/api/v1/products', '/api/v1/products/{id}', '/api/v1/orders', '/api/v1/orders/{id}']) {
    assert.ok(docs.split('\n').some((line) => line.includes('`GET ' + path + '`') && line.includes('planned')), path);
  }
});
