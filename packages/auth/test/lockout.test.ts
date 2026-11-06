
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocked, recordFailedAttempt, recordSuccess, MAX_LOGIN_ATTEMPTS, LOCK_DURATION_MS } from '../src/lockout';

const T0 = new Date('2026-01-01T00:00:00Z');

function failMany(times: number, start = T0) {
let state = { loginAttempts: 0, lockUntil: null as Date | null };
for (let i = 0; i < times; i++) state = recordFailedAttempt(state, start);
return state;
}

test('seven failures do not lock', () => {
const state = failMany(MAX_LOGIN_ATTEMPTS - 1);
assert.equal(isLocked(state, T0), false);
});

test('the eighth failure locks for ten minutes', () => {
const state = failMany(MAX_LOGIN_ATTEMPTS);
assert.equal(isLocked(state, T0), true);
assert.equal(state.lockUntil?.getTime(), T0.getTime() + LOCK_DURATION_MS);
});

test('the lock lifts after the duration', () => {
const state = failMany(MAX_LOGIN_ATTEMPTS);
assert.equal(isLocked(state, new Date(T0.getTime() + LOCK_DURATION_MS + 1)), false);
});

test('failures while locked do not extend or reset the lock', () => {
const state = failMany(MAX_LOGIN_ATTEMPTS);
const next = recordFailedAttempt(state, new Date(T0.getTime() + 60_000));
assert.equal(next.lockUntil?.getTime(), state.lockUntil?.getTime());
});

test('the counter restarts after an expired lock', () => {
const locked = failMany(MAX_LOGIN_ATTEMPTS);
const later = new Date(T0.getTime() + LOCK_DURATION_MS + 1);
const next = recordFailedAttempt(locked, later);
assert.equal(next.loginAttempts, 1);
assert.equal(next.lockUntil, null);
});

test('a successful login clears the counter', () => {
const state = recordSuccess();
assert.equal(state.loginAttempts, 0);
assert.equal(state.lockUntil, null);
});
