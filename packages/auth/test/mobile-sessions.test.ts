import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOBILE_ADMIN_AUDIENCE,
  MOBILE_SELLER_AUDIENCE,
  mintMobileRefreshToken,
  mongoMobileDeviceStore,
  newMobileFamily,
  readMobileRefreshToken,
  signMobileAccessToken,
  verifyMobileAccessToken,
} from '../src/mobile-sessions';
import { signSession, verifySession } from '../src/session';

// Sprint 9 (EP-31.US01): the tokens of the phone apps and the queries of the real device store (the one the backends run; the route tests use the memory one).

const SECRET = 's'.repeat(40);
const OTHER = 't'.repeat(40);

test('an access token is bound to its app, expires after 15 minutes and is not a web session (and the other way round)', async () => {
  const claims = { sub: '65a000000000000000000001', role: 'seller', tv: 2, fam: newMobileFamily() };
  const token = await signMobileAccessToken(claims, SECRET, MOBILE_SELLER_AUDIENCE);
  assert.deepEqual(await verifyMobileAccessToken(token, SECRET, MOBILE_SELLER_AUDIENCE), claims);
  await assert.rejects(verifyMobileAccessToken(token, SECRET, MOBILE_ADMIN_AUDIENCE));
  await assert.rejects(verifyMobileAccessToken(token, OTHER, MOBILE_SELLER_AUDIENCE));
  await assert.rejects(verifySession(token, SECRET, 'seller-backend'));
  await assert.rejects(verifyMobileAccessToken(await signSession({ sub: claims.sub, role: 'seller' }, SECRET, MOBILE_SELLER_AUDIENCE), SECRET, MOBILE_SELLER_AUDIENCE), 'no family claim');
  const old = await signMobileAccessToken(claims, SECRET, MOBILE_SELLER_AUDIENCE, new Date(Date.now() - 16 * 60 * 1000));
  await assert.rejects(verifyMobileAccessToken(old, SECRET, MOBILE_SELLER_AUDIENCE));
});

test('a refresh token is read only by the backend and app that made it; two tokens of one family differ', () => {
  const family = newMobileFamily();
  assert.match(family, /^[A-Za-z0-9_-]{24}$/);
  const first = mintMobileRefreshToken(family, SECRET, MOBILE_SELLER_AUDIENCE);
  const second = mintMobileRefreshToken(family, SECRET, MOBILE_SELLER_AUDIENCE);
  assert.notEqual(first.token, second.token);
  assert.deepEqual(readMobileRefreshToken(first.token, SECRET, MOBILE_SELLER_AUDIENCE), { family, hash: first.hash });
  assert.equal(readMobileRefreshToken(first.token, SECRET, MOBILE_ADMIN_AUDIENCE), null);
  assert.equal(readMobileRefreshToken(first.token, OTHER, MOBILE_SELLER_AUDIENCE), null);
  for (const bad of [undefined, 42, '', 'a.b.c.d', first.token + 'a', 'mzr1.' + newMobileFamily() + first.token.slice(29)]) {
    assert.equal(readMobileRefreshToken(bad, SECRET, MOBILE_SELLER_AUDIENCE), null);
  }
});

function fakeModel() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  let result: unknown = null;
  const query = () => {
    const q: any = {
      select: (fields: string) => (calls.push({ op: 'select', args: [fields] }), q),
      sort: () => q,
      limit: () => q,
      lean: async () => result,
    };
    return q;
  };
  return {
    calls,
    answer(value: unknown) {
      result = value;
    },
    create: async (doc: Record<string, unknown>) => (calls.push({ op: 'create', args: [doc] }), { _id: 'new-id' }),
    findOne: (filter: Record<string, unknown>) => (calls.push({ op: 'findOne', args: [filter] }), query()),
    find: (filter: Record<string, unknown>) => (calls.push({ op: 'find', args: [filter] }), query()),
    updateOne: async (...args: unknown[]) => (calls.push({ op: 'updateOne', args }), { modifiedCount: 1 }),
    updateMany: async (...args: unknown[]) => (calls.push({ op: 'updateMany', args }), { modifiedCount: 3 }),
  };
}

test('the Mongo store: a refresh is one compare-and-set on the old hash of a live row; a revoke keeps the row and clears the push token', async () => {
  const model = fakeModel();
  const store = mongoMobileDeviceStore(model);
  const at = new Date('2026-01-02T03:04:05Z');
  assert.equal(await store.rotate('fam', 'old-hash', { refreshHash: 'new-hash', refreshExpiresAt: at, lastSeenAt: at }), true);
  assert.deepEqual(model.calls.at(-1)!.args, [{ family: 'fam', refreshHash: 'old-hash', revokedAt: null }, { $set: { refreshHash: 'new-hash', refreshExpiresAt: at, lastSeenAt: at } }]);
  assert.equal(await store.revokeFamily('fam', 'logout', at), true);
  assert.deepEqual(model.calls.at(-1)!.args, [{ family: 'fam', revokedAt: null }, { $set: { revokedAt: at, revokedReason: 'logout', pushToken: null } }]);
  assert.equal(await store.revokeAll({ app: 'seller', user: 'u1', exceptTokenVersion: 4 }, 'password_changed', at), 3);
  assert.deepEqual(model.calls.at(-1)!.args[0], { app: 'seller', user: 'u1', revokedAt: null, tokenVersion: { $ne: 4 } });
  await store.revokeAll({ app: 'admin', user: 'u1', installationId: 'inst-1234' }, 'replaced', at);
  assert.deepEqual(model.calls.at(-1)!.args[0], { app: 'admin', user: 'u1', revokedAt: null, installationId: 'inst-1234' });
});

test('the Mongo store: the refresh hash is selected only to compare it, a device is looked up with its owner and app, dates and ids are normalised', async () => {
  const model = fakeModel();
  const store = mongoMobileDeviceStore(model);
  model.answer({ _id: 'id1', app: 'seller', user: 'u1', family: 'fam', refreshHash: 'h', refreshExpiresAt: '2026-02-01T00:00:00Z', tokenVersion: 1, lastSeenAt: new Date(), revokedAt: null });
  const row = (await store.findByFamily('fam'))!;
  assert.deepEqual(model.calls.map((c) => c.op), ['findOne', 'select']);
  assert.equal(row.refreshHash, 'h');
  assert.equal(row.refreshExpiresAt.toISOString(), '2026-02-01T00:00:00.000Z');
  await store.findForUser('seller', 'u1', 'id1');
  assert.deepEqual(model.calls.at(-1)!.args[0], { _id: 'id1', app: 'seller', user: 'u1' });
  model.answer([]);
  await store.listForUser('seller', 'u1');
  assert.deepEqual(model.calls.at(-1)!.args[0], { app: 'seller', user: 'u1', revokedAt: null });
  model.answer(null);
  assert.equal(await store.findByFamily('none'), null);
});
