import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_TOKEN_TTL_MS,
  consumeAuthToken,
  createAuthToken,
  createAuthRateLimiter,
  createSessionGuard,
  hashAuthToken,
  memoryRateCounterStore,
  RateLimitedError,
  SessionRejectedError,
  signSession,
  toSessionUserRecord,
  verifySession,
  type RateCounterStore,
  type SessionUserRecord,
} from '../src';
import { fakeTokens } from './helpers/fake-tokens';

// Sprint 4 EP-08: the account tokens, the session guard, the token version claim and the account limits. Fakes only.

const USER = '65a000000000000000000001';
const T0 = new Date('2026-11-14T10:00:00Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

test('a token is stored only as its SHA-256 hash and works once', async () => {
  const { rows, model } = fakeTokens();
  const { raw, expiresAt } = await createAuthToken(model, { userId: USER, kind: 'password_reset', now: T0 });
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.tokenHash, hashAuthToken(raw));
  assert.equal(JSON.stringify(rows).includes(raw), false, 'the raw token is never stored');
  assert.equal(expiresAt.getTime(), T0.getTime() + AUTH_TOKEN_TTL_MS.password_reset);

  const first = await consumeAuthToken(model, raw, ['password_reset'], later(60_000));
  assert.deepEqual(first, { userId: USER, kind: 'password_reset', newEmail: null });
  assert.equal(await consumeAuthToken(model, raw, ['password_reset'], later(61_000)), null, 'a used token is refused');
});

test('an expired, wrong, malformed or other-kind token is refused the same way', async () => {
  const { model } = fakeTokens();
  const { raw } = await createAuthToken(model, { userId: USER, kind: 'password_reset', now: T0 });
  assert.equal(await consumeAuthToken(model, raw, ['password_reset'], later(AUTH_TOKEN_TTL_MS.password_reset + 1)), null, 'expired after 30 minutes');
  const { raw: verify } = await createAuthToken(model, { userId: USER, kind: 'email_verify', now: T0 });
  assert.equal(await consumeAuthToken(model, verify, ['password_reset'], later(1000)), null, 'another kind');
  assert.equal(await consumeAuthToken(model, 'x'.repeat(43), ['email_verify'], later(1000)), null, 'unknown');
  assert.equal(await consumeAuthToken(model, 'short', ['email_verify'], later(1000)), null, 'malformed');
  assert.equal(await consumeAuthToken(model, undefined, ['email_verify'], later(1000)), null);
  assert.ok(await consumeAuthToken(model, verify, ['email_verify'], later(AUTH_TOKEN_TTL_MS.email_verify - 1000)), 'verify lives 24 hours');
});

test('a new token of a kind makes the older one useless', async () => {
  const { model } = fakeTokens();
  const old = await createAuthToken(model, { userId: USER, kind: 'password_reset', now: T0 });
  const fresh = await createAuthToken(model, { userId: USER, kind: 'password_reset', now: later(1000) });
  assert.equal(await consumeAuthToken(model, old.raw, ['password_reset'], later(2000)), null);
  assert.ok(await consumeAuthToken(model, fresh.raw, ['password_reset'], later(2000)));
});

test('the session carries tv; an older token without tv reads as 0', async () => {
  const secret = 's'.repeat(40);
  const withTv = await verifySession(await signSession({ sub: USER, role: 'seller', tv: 3 }, secret, 'seller-backend'), secret, 'seller-backend');
  assert.equal(withTv.tv, 3);
  const old = await verifySession(await signSession({ sub: USER, role: 'seller' }, secret, 'seller-backend'), secret, 'seller-backend');
  assert.equal(old.tv, undefined);
});

function guardWith(record: SessionUserRecord | null, options: { ttlMs?: number } = {}) {
  let reads = 0;
  let current = record;
  const guard = createSessionGuard(async () => {
    reads += 1;
    return current;
  }, options);
  return { guard, reads: () => reads, set: (next: SessionUserRecord | null) => void (current = next) };
}

const ACTIVE: SessionUserRecord = { role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: null };

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof SessionRejectedError);
    return err.code;
  }
  throw new Error('expected a rejection');
}

test('the guard refuses suspended and blocked accounts, other roles, missing users and older token versions', async () => {
  assert.equal(await rejection(guardWith({ ...ACTIVE, accountStatus: 'suspended' }).guard.check({ sub: USER, role: 'seller' })), 'ACCOUNT_SUSPENDED');
  assert.equal(await rejection(guardWith({ ...ACTIVE, accountStatus: 'blocked' }).guard.check({ sub: USER, role: 'seller' })), 'ACCOUNT_SUSPENDED');
  assert.equal(await rejection(guardWith(null).guard.check({ sub: USER, role: 'seller' })), 'SESSION_REVOKED');
  assert.equal(await rejection(guardWith(ACTIVE).guard.check({ sub: USER, role: 'admin' })), 'SESSION_REVOKED');
  assert.equal(await rejection(guardWith({ ...ACTIVE, tokenVersion: 2 }).guard.check({ sub: USER, role: 'seller', tv: 1 })), 'SESSION_REVOKED');
});

test('a token from before tv existed is accepted while the account is at version 0', async () => {
  const { guard } = guardWith(toSessionUserRecord({ role: 'seller' }));
  const record = await guard.check({ sub: USER, role: 'seller' });
  assert.equal(record.tokenVersion, 0);
  assert.equal(record.accountStatus, 'active', 'a missing status reads as active');
});

test('accounts are cached for at most 30 seconds, and forget() drops one at once', async () => {
  const g = guardWith(ACTIVE, { ttlMs: 60_000 });
  const now = Date.now();
  await g.guard.check({ sub: USER, role: 'seller' }, now);
  await g.guard.check({ sub: USER, role: 'seller' }, now + 10_000);
  assert.equal(g.reads(), 1, 'served from the cache');
  await g.guard.check({ sub: USER, role: 'seller' }, now + 30_001);
  assert.equal(g.reads(), 2, 'the ttl is capped at 30 seconds');

  g.set({ ...ACTIVE, accountStatus: 'suspended' });
  await g.guard.check({ sub: USER, role: 'seller' }, now + 30_002);
  g.guard.forget(USER);
  assert.equal(await rejection(g.guard.check({ sub: USER, role: 'seller' }, now + 30_003)), 'ACCOUNT_SUSPENDED');
});

test('the limiter counts, refuses past the limit with a Retry-After, resets, and fails open', async () => {
  const store = memoryRateCounterStore();
  const limiter = createAuthRateLimiter(() => store, () => {});
  const rule = { name: 'test', limit: 3, windowMs: 60_000 };
  const now = Date.UTC(2026, 10, 14, 10, 0, 30);
  for (let i = 0; i < 3; i += 1) await limiter.consume(rule, 'a@example.com', now);
  await assert.rejects(limiter.consume(rule, 'A@example.com ', now), (err: unknown) => err instanceof RateLimitedError && err.retryAfterSeconds === 30);
  assert.equal([...store.counts.keys()].some((k) => k.includes('example')), false, 'the subject is hashed into the key');

  for (let i = 0; i < 3; i += 1) await limiter.record(rule, 'b@example.com', now);
  await assert.rejects(limiter.assertBelow(rule, 'b@example.com', now), RateLimitedError);
  await limiter.reset(rule, 'b@example.com', now);
  await limiter.assertBelow(rule, 'b@example.com', now);

  const broken: RateCounterStore = {
    increment: async () => {
      throw new Error('down');
    },
    read: async () => {
      throw new Error('down');
    },
    remove: async () => {},
  };
  const open = createAuthRateLimiter(() => broken, () => {});
  await open.consume(rule, 'c@example.com', now);
  await open.assertBelow(rule, 'c@example.com', now);
});
