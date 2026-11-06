
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userSchema, USER_ROLES } from '../src/user';
import { failingPaths } from './helpers';

const OID = '65a000000000000000000002';
const NOW = '2026-10-01T00:00:00.000Z';

function validUser(overrides: Record<string, unknown> = {}) {
  return {
    id: OID,
    name: 'Ali',
    email: 'ali@example.com',
    role: 'seller',
    store: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('a public user parses', () => {
  assert.equal(userSchema.safeParse(validUser()).success, true);
});

test('the secret fields never survive parsing', () => {
  const parsed = userSchema.parse({
    ...validUser(),
    passwordHash: 'hash',
    loginAttempts: 3,
    lockUntil: NOW,
  });
  assert.equal('passwordHash' in parsed, false);
  assert.equal('loginAttempts' in parsed, false);
  assert.equal('lockUntil' in parsed, false);
});

test('the role set is admin and seller', () => {
  assert.deepEqual([...USER_ROLES], ['admin', 'seller']);
});

test('an unknown role is reported against role', () => {
  assert.deepEqual(failingPaths(userSchema.safeParse(validUser({ role: 'superuser' }))), ['role']);
});

test('a missing email is reported against email', () => {
  const { email: _omit, ...rest } = validUser();
  assert.deepEqual(failingPaths(userSchema.safeParse(rest)), ['email']);
});
