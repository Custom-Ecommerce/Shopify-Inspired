
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginRequestSchema, signupRequestSchema, signupResponseSchema, sessionUserSchema } from '../src/auth';
import { failingPaths } from './helpers';

const OID = '65a000000000000000000001';

test('a valid login request parses', () => {
  assert.equal(loginRequestSchema.safeParse({ email: 'ali@example.com', password: 'x' }).success, true);
});

test('a malformed email is reported against email', () => {
  assert.deepEqual(failingPaths(loginRequestSchema.safeParse({ email: 'nope', password: 'x' })), ['email']);
});

test('a signup password under eight characters is reported against password', () => {
  const bad = { name: 'Ali', email: 'ali@example.com', password: 'short' };
  assert.deepEqual(failingPaths(signupRequestSchema.safeParse(bad)), ['password']);
});

test('a valid signup request parses', () => {
  const ok = { name: 'Ali', email: 'ali@example.com', password: 'longenough' };
  assert.equal(signupRequestSchema.safeParse(ok).success, true);
});

test('the session user carries id, not _id, and no secret fields', () => {
  const user = { id: OID, name: 'Ali', email: 'ali@example.com', role: 'seller', store: null };
  const parsed = sessionUserSchema.parse({ ...user, passwordHash: 'h', lockUntil: 'x' });
  assert.equal(parsed.id, OID);
  assert.equal('passwordHash' in parsed, false);
});

test('a signup response must report success true', () => {
  const user = { id: OID, name: 'Ali', email: 'ali@example.com', role: 'seller', store: null };
  assert.deepEqual(failingPaths(signupResponseSchema.safeParse({ success: false, token: 't', user })), ['success']);
});
