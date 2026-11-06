
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from '../src/session';

const SECRET = 'x'.repeat(40);

test('round trip with the matching audience succeeds', async () => {
const token = await signSession({ sub: 'user-1', role: 'admin' }, SECRET, 'admin-backend');
const claims = await verifySession(token, SECRET, 'admin-backend');
assert.equal(claims.sub, 'user-1');
assert.equal(claims.role, 'admin');
});

test('a token minted for one backend is rejected by another', async () => {
const token = await signSession({ sub: 'user-1', role: 'seller' }, SECRET, 'seller-backend');
await assert.rejects(verifySession(token, SECRET, 'admin-backend'));
});

test('a tampered token is rejected', async () => {
const token = await signSession({ sub: 'user-1', role: 'admin' }, SECRET, 'admin-backend');
const parts = token.split('.');
parts[1] = Buffer.from(JSON.stringify({ sub: 'user-2', role: 'admin', aud: 'admin-backend' })).toString('base64url');
await assert.rejects(verifySession(parts.join('.'), SECRET, 'admin-backend'));
});

test('a secret shorter than 32 characters is refused', async () => {
await assert.rejects(signSession({ sub: 'user-1', role: 'admin' }, 'short', 'admin-backend'));
});
