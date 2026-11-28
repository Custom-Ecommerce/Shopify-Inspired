import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, memoryMobileDeviceStore, signMobileAccessToken, signSession, User, MOBILE_SELLER_AUDIENCE } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setSessionUserLoader } from '@/lib/session-user';
import { setMobileDeviceStore } from '@/lib/mobile-auth';
import { setPushDeps, pushOrderCancelled, pushOrderPlaced, pushPaymentClaim, pushSupportReply, pushTicketNew } from '@/lib/push';
import type { PushDeps, PushMessage } from '@markaz/notifications';

// Sprint 9 (EP-31.US02.T01, T02): the push token and switch routes, and the seller backend's push events with fake models and a fake push service.

const SECRET = 'p'.repeat(40);
const SELLER = '65a000000000000000000001';
const MEMBER = '65a000000000000000000002';
const STORE = '65b000000000000000000001';
const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

const UserModel = User as any;
const AuditModel = AuditLog as any;
let devices: ReturnType<typeof memoryMobileDeviceStore>;
let prefs: any;
let writes: any[];
let restore: () => void = () => {};
let routes: Record<string, (r: any) => Promise<Response>>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  routes = {
    token: (await import('../src/app/api/mobile/v1/devices/push-token/route')).POST,
    get: (await import('../src/app/api/mobile/v1/push-settings/route')).GET,
    patch: (await import('../src/app/api/mobile/v1/push-settings/route')).PATCH,
  };
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  setSessionUserLoader(async () => ({ role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: null }), { ttlMs: 0 });
  devices = memoryMobileDeviceStore();
  setMobileDeviceStore(devices);
  prefs = undefined;
  writes = [];
  const saved = { connect: (mongoose as any).connect, findById: UserModel.findById, update: UserModel.findOneAndUpdate, audit: AuditModel.create };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => chain(() => ({ pushPrefs: prefs }));
  UserModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      writes.push({ filter, update });
      prefs = { muted: update.$set['pushPrefs.muted'] ?? prefs?.muted ?? false, mutedKinds: update.$set['pushPrefs.mutedKinds'] ?? prefs?.mutedKinds ?? [] };
      return { pushPrefs: prefs };
    });
  AuditModel.create = async () => ({ _id: new mongoose.Types.ObjectId() });
  restore = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findById = saved.findById;
    UserModel.findOneAndUpdate = saved.update;
    AuditModel.create = saved.audit;
  };
});
afterEach(() => {
  restore();
  setSessionUserLoader(null);
  setMobileDeviceStore(null);
  setPushDeps(null);
});

async function phone(family: string, user = SELLER) {
  const now = new Date();
  const { id } = await devices.create({ app: 'seller', user, family, name: 'Phone', platform: 'android', appVersion: '1.0.0', installationId: null, refreshHash: 'h'.repeat(64), refreshExpiresAt: new Date(now.getTime() + 60_000), tokenVersion: 0, lastSeenAt: now });
  return { id, bearer: await signMobileAccessToken({ sub: user, role: 'seller', tv: 0, fam: family }, SECRET, MOBILE_SELLER_AUDIENCE) };
}
const req = (method: string, url: string, bearer: string, body?: unknown) =>
  new NextRequest('http://seller.test' + url, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer }, body: body === undefined ? undefined : JSON.stringify(body) });
const register = (bearer: string, token: unknown) => routes.token!(req('POST', '/api/mobile/v1/devices/push-token', bearer, { token }));

test('a phone registers its push token; the same token moves off any other phone; null removes it', async () => {
  const one = await phone('a'.repeat(24));
  const two = await phone('b'.repeat(24));
  assert.deepEqual(await (await register(one.bearer, TOKEN)).json(), { ok: true, registered: true });
  assert.equal((await register(two.bearer, TOKEN)).status, 200);
  assert.deepEqual(devices.rows.map((r) => r.pushToken), [null, TOKEN]);
  assert.deepEqual(await (await register(two.bearer, null)).json(), { ok: true, registered: false });
  assert.equal(devices.rows[1]!.pushToken, null);
});

test('a bad token is a 400 naming it, a web session is PHONE_ONLY, and a signed-out phone is refused', async () => {
  const one = await phone('a'.repeat(24));
  const bad = await register(one.bearer, 'not-a-token');
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { field: string }).field, 'token');
  const web = await signSession({ sub: SELLER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  const refused = await register(web, TOKEN);
  assert.equal(refused.status, 403);
  assert.equal(((await refused.json()) as { code: string }).code, 'PHONE_ONLY');
  await devices.revokeFamily('a'.repeat(24), 'logout', new Date());
  assert.equal((await register(one.bearer, TOKEN)).status, 401);
});

test('the push switches: read, mute everything or some kinds, unknown kinds refused', async () => {
  const one = await phone('a'.repeat(24));
  const get = await (await routes.get!(req('GET', '/api/mobile/v1/push-settings', one.bearer))).json();
  assert.deepEqual(get, { muted: false, mutedKinds: [], kinds: ['order_new', 'order_cancelled', 'low_stock', 'subscription_payment', 'support_reply'] });
  const patch = await routes.patch!(req('PATCH', '/api/mobile/v1/push-settings', one.bearer, { mutedKinds: ['low_stock', 'low_stock'] }));
  assert.equal(patch.status, 200);
  assert.deepEqual(((await patch.json()) as any).mutedKinds, ['low_stock']);
  assert.equal(String(writes[0].filter._id), SELLER, 'only the caller\'s own account');
  assert.equal((await routes.patch!(req('PATCH', '/x', one.bearer, { mutedKinds: ['everything'] }))).status, 400);
  assert.equal((await routes.patch!(req('PATCH', '/x', one.bearer, {}))).status, 400);
  assert.equal((await routes.patch!(req('PATCH', '/x', one.bearer, { muted: true, other: 1 }))).status, 400);
});

test('quiet hours are saved on the account of the caller, removed with null, and a bad time is refused', async () => {
  const one = await phone('a'.repeat(24));
  const hours = { start: '22:00', end: '07:00' };
  assert.equal((await routes.patch!(req('PATCH', '/api/mobile/v1/push-settings', one.bearer, { quietHours: hours }))).status, 200);
  assert.equal(String(writes.at(-1)!.filter._id), SELLER);
  assert.deepEqual((writes.at(-1) as any).update.$set, { 'pushPrefs.quietHours': hours });
  assert.equal((await routes.patch!(req('PATCH', '/x', one.bearer, { quietHours: null }))).status, 200);
  assert.deepEqual((writes.at(-1) as any).update.$set, { 'pushPrefs.quietHours': null });
  assert.equal((await routes.patch!(req('PATCH', '/x', one.bearer, { quietHours: { start: '9pm', end: '07:00' } }))).status, 400);
});

function fakeDeps() {
  const rows: any[] = [];
  const sent: PushMessage[] = [];
  const query = (value: unknown) => ({ select: () => ({ lean: async () => value }) });
  const live = { revokedAt: null, tokenVersion: 0 };
  const users = [SELLER, MEMBER, 'admin1'].map((id) => ({ _id: id, accountStatus: 'active', tokenVersion: 0 }));
  const deps: PushDeps = {
    outbox: {
      create: async (doc: any) => (rows.push(doc), { _id: 'r' + rows.length }),
      findOne: () => ({ lean: async () => null }),
      find: () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [] }),
      findOneAndUpdate: () => ({ lean: async () => null }),
    },
    models: {
      devices: {
        find: (f: any) =>
          query(
            (f.app === 'admin' ? [{ _id: 'ad', user: 'admin1', pushToken: TOKEN, ...live }] : [{ _id: 'so', user: SELLER, pushToken: TOKEN, ...live }, { _id: 'sm', user: MEMBER, pushToken: TOKEN, ...live }]).filter((d) =>
              f.user.$in.includes(d.user),
            ),
          ),
      },
      users: { find: (f: any) => query(f.role === 'admin' ? [{ _id: 'admin1', adminLevel: 'owner' }] : users.filter((u) => f._id.$in.includes(u._id))) },
      stores: { findById: () => query({ owner: SELLER }) },
      members: { find: () => query([{ user: MEMBER, role: 'staff' }]) },
    },
    channel: { client: { name: 'fake', send: async (m) => (sent.push(m), { ok: true }) }, onDeadToken: async () => {} },
    count: (() => {
      const seen = new Map<string, number>();
      return async (key: string) => {
        seen.set(key, (seen.get(key) ?? 0) + 1);
        return seen.get(key)!;
      };
    })(),
    schedule: () => {},
  };
  return { deps, rows, sent };
}

const ORDER = { _id: '65c000000000000000000001', orderId: 'MZ-1001', total: 2500, customerName: 'Ayesha', phone: '03001234567', customerEmail: 'a@example.com' };

test('a new order is pushed to the owner and the staff with the number and amount only, once', async () => {
  const w = fakeDeps();
  setPushDeps(w.deps);
  assert.equal((await pushOrderPlaced(STORE, ORDER))!.queued, 2);
  assert.equal((await pushOrderPlaced(STORE, ORDER))!.queued, 0);
  const text = JSON.stringify(w.rows.map((r) => [r.subject, r.bodyText, r.payload]));
  assert.match(w.rows[0].bodyText, /^Order MZ-1001 - Rs\. 2,500$/);
  assert.equal(/Ayesha|0300|a@example/.test(text), false);
  assert.deepEqual(w.rows[0].payload.data, { screen: 'order', storeId: STORE, orderId: ORDER._id });
});

test('a cancellation is not pushed to the person who recorded it; ticket and payment events go to their audiences', async () => {
  const w = fakeDeps();
  setPushDeps(w.deps);
  assert.equal((await pushOrderCancelled(STORE, ORDER, MEMBER))!.queued, 1);
  assert.equal((await pushSupportReply(SELLER, '65d000000000000000000001', 3))!.queued, 1);
  assert.equal((await pushPaymentClaim('65e000000000000000000001', 2500))!.queued, 1);
  assert.equal((await pushTicketNew('65d000000000000000000001'))!.queued, 1);
  assert.deepEqual(w.rows.map((r) => [r.payload.app, r.payload.kind]), [['seller', 'order_cancelled'], ['seller', 'support_reply'], ['admin', 'payment_claim'], ['admin', 'ticket_new']]);
});

test('without an open database and without a test double, a push does nothing and never throws', async () => {
  assert.equal(await pushOrderPlaced(STORE, ORDER), null);
});
