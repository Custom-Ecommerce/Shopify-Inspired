import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { AuditLog, User, assertCan, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setSessionUserLoader } from '@/lib/session-user';

// Sprint 6 EP-12.US02.T02 (D-118): the signed internal call that sets a seller's store-limit override in the seller database.
// Models are stubbed in memory; no database.

const SECRET = 'm'.repeat(40);
const AUTH_SECRET = 'x'.repeat(40);
const ADMIN = '65a000000000000000000003';
const SELLER = '65a000000000000000000001';
const OTHER_SELLER = '65a000000000000000000002';
const UserModel = User as any;
const AuditModel = AuditLog as any;

let users: Record<string, Record<string, any>>;
let audits: Array<Record<string, any>>;
let storeLimitPOST: (r: NextRequest) => Promise<Response>;
let restore: () => void = () => {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  storeLimitPOST = (await import('../src/app/api/internal/accounts/store-limit/route')).POST;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  process.env.MODERATION_API_SECRET = SECRET;
  users = {
    [SELLER]: { _id: SELLER, role: 'seller' },
    [OTHER_SELLER]: { _id: OTHER_SELLER, role: 'seller', storeLimitOverride: 6 },
    [ADMIN]: { _id: ADMIN, role: 'admin' },
  };
  audits = [];
  const saved = { connect: (mongoose as any).connect, findOne: UserModel.findOne, findOneAndUpdate: UserModel.findOneAndUpdate, audit: AuditModel.create };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findOne = (filter: any) => chain(() => (users[String(filter._id)] && users[String(filter._id)]!.role === filter.role ? { ...users[String(filter._id)] } : null));
  UserModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = users[String(filter._id)];
      if (!row || row.role !== filter.role) return null;
      const current = row.storeLimitOverride ?? null;
      if (current !== filter.storeLimitOverride) return null;
      Object.assign(row, update.$set);
      return { ...row };
    });
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findOne = saved.findOne;
    UserModel.findOneAndUpdate = saved.findOneAndUpdate;
    AuditModel.create = saved.audit;
    delete process.env.MODERATION_API_SECRET;
  };
});

afterEach(() => restore());

const signed = (body: unknown, secret = SECRET): NextRequest => {
  const path = '/api/internal/accounts/store-limit';
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://seller.test' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...internalRequestHeaders(secret, { method: 'POST', path, adminId: ADMIN, body: raw }) },
    body: raw,
  });
};

test('a signed call sets the override, audits it with who and the old and new value, and answers changed', async () => {
  const res = await storeLimitPOST(signed({ userId: SELLER, storeLimitOverride: 5 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { userId: SELLER, storeLimitOverride: 5, changed: true });
  assert.equal(users[SELLER]!.storeLimitOverride, 5);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'user.store_limit');
  assert.deepEqual([audits[0]!.details.from, audits[0]!.details.to], [null, 5]);
});

test('clearing the override (null) removes it', async () => {
  const res = await storeLimitPOST(signed({ userId: OTHER_SELLER, storeLimitOverride: null }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { userId: OTHER_SELLER, storeLimitOverride: null, changed: true });
  assert.equal(users[OTHER_SELLER]!.storeLimitOverride, null);
  assert.deepEqual([audits[0]!.details.from, audits[0]!.details.to], [6, null]);
});

test('the same value again is a 200 no-op with changed false and no audit entry (a retry is harmless)', async () => {
  const res = await storeLimitPOST(signed({ userId: OTHER_SELLER, storeLimitOverride: 6 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { userId: OTHER_SELLER, storeLimitOverride: 6, changed: false });
  assert.equal(audits.length, 0);
  const none = await storeLimitPOST(signed({ userId: SELLER, storeLimitOverride: null }));
  assert.equal(((await none.json()) as { changed: boolean }).changed, false);
});

test('an unknown seller, and an admin account, are 404: the override is for seller accounts only', async () => {
  assert.equal((await storeLimitPOST(signed({ userId: '65a0000000000000000000ff', storeLimitOverride: 3 }))).status, 404);
  assert.equal((await storeLimitPOST(signed({ userId: ADMIN, storeLimitOverride: 3 }))).status, 404);
  assert.equal(users[ADMIN]!.storeLimitOverride, undefined);
});

test('a change made by someone else in between is a 409, not a silent overwrite', async () => {
  const original = UserModel.findOneAndUpdate;
  UserModel.findOneAndUpdate = () => chain(() => null);
  try {
    const res = await storeLimitPOST(signed({ userId: SELLER, storeLimitOverride: 4 }));
    assert.equal(res.status, 409);
    assert.equal(users[SELLER]!.storeLimitOverride, undefined);
  } finally {
    UserModel.findOneAndUpdate = original;
  }
});

test('the body is checked: 0, a fraction, a text, a missing value, an extra key, a bad id and a huge value are all 422', async () => {
  for (const body of [
    { userId: SELLER, storeLimitOverride: 0 },
    { userId: SELLER, storeLimitOverride: 2.5 },
    { userId: SELLER, storeLimitOverride: '3' },
    { userId: SELLER },
    { userId: SELLER, storeLimitOverride: 3, role: 'admin' },
    { userId: 'nope', storeLimitOverride: 3 },
    { userId: SELLER, storeLimitOverride: 100000 },
  ]) {
    assert.equal((await storeLimitPOST(signed(body))).status, 422, JSON.stringify(body));
  }
  assert.equal(users[SELLER]!.storeLimitOverride, undefined);
});

test('only the admin backend signature is accepted: none, a wrong secret and a seller session are 401, and an unset secret is 503', async () => {
  const body = JSON.stringify({ userId: SELLER, storeLimitOverride: 9 });
  const path = '/api/internal/accounts/store-limit';
  assert.equal((await storeLimitPOST(new NextRequest('http://seller.test' + path, { method: 'POST', body, headers: { 'content-type': 'application/json' } }))).status, 401);
  assert.equal((await storeLimitPOST(signed({ userId: SELLER, storeLimitOverride: 9 }, 'z'.repeat(40)))).status, 401);

  const token = await signSession({ sub: SELLER, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  setSessionUserLoader(async () => ({ role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date() }) as any);
  try {
    const asSeller = new NextRequest('http://seller.test' + path, { method: 'POST', body, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token } });
    assert.equal((await storeLimitPOST(asSeller)).status, 401, 'a seller cannot raise their own limit');
  } finally {
    setSessionUserLoader(null);
  }

  delete process.env.MODERATION_API_SECRET;
  assert.equal((await storeLimitPOST(signed({ userId: SELLER, storeLimitOverride: 9 }))).status, 503, 'not configured: nothing is applied');
  assert.equal(users[SELLER]!.storeLimitOverride, undefined);
});

test('the policy: only an admin (and the system) may write storeLimitOverride', () => {
  assert.doesNotThrow(() => assertCan('admin', 'update', 'sellers', ['storeLimitOverride']));
  for (const actor of ['seller', 'public'] as const) assert.throws(() => assertCan(actor, 'update', 'sellers', ['storeLimitOverride']), actor);
  for (const actor of ['seller', 'public'] as const) assert.throws(() => assertCan(actor, 'update', 'users', ['storeLimitOverride']), actor);
});
