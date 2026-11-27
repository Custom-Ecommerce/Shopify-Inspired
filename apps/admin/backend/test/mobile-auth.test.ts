import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, User, base32Decode, hashPassword, hotp, memoryMobileDeviceStore, signSession, totpStep } from './_mobile';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { useMemoryAdminAuthLimits } from '@/lib/admin-account';
import { setAdminMobileDeviceStore, setMinAdminAppVersionLoader } from '@/lib/mobile-auth';
import { setSecondFactorStore, type SecondFactorRecord, type SecondFactorStore } from '@/lib/second-factor';
import { setAdminStatus, adminUserSteps } from '@/lib/admin-users';
import { pushSyncFailure, setAdminPushDeps } from '@/lib/push';

// Sprint 9 (EP-31.US01.T06 to T09): the admin phone sign-in, the TOTP second factor, the version gate and the audit lines. Models are stubbed; devices,
// second factors and limits live in memory.

const SECRET = 'a'.repeat(40);
const OWNER = '65a000000000000000000001';
const OPERATOR = '65a000000000000000000002';
const PASSWORD = 'correct-horse-battery-staple';
const UserModel = User as any;
const AuditModel = AuditLog as any;

let users: Array<Record<string, any>>;
let audits: any[];
let logged: string[];
let factors: Map<string, SecondFactorRecord & { recovery: string[] }>;
let devices: ReturnType<typeof memoryMobileDeviceStore>;
let hash = '';
let restore: () => void = () => {};
let routes: Record<string, (r: Request, c?: any) => Promise<Response>>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  hash = await hashPassword(PASSWORD);
  routes = {
    login: (await import('../src/app/api/admin/mobile/v1/auth/login/route')).POST,
    refresh: (await import('../src/app/api/admin/mobile/v1/auth/refresh/route')).POST,
    logout: (await import('../src/app/api/admin/mobile/v1/auth/logout/route')).POST,
    list: (await import('../src/app/api/admin/mobile/v1/devices/route')).GET,
    revoke: (await import('../src/app/api/admin/mobile/v1/devices/[id]/revoke/route')).POST,
    reset: (await import('../src/app/api/admin/users/[id]/reset-second-factor/route')).POST,
    me: (await import('../src/app/api/admin/me/route')).GET,
  };
});

const memoryFactors: SecondFactorStore = {
  find: async (id) => {
    const row = factors.get(id);
    return row ? { secretSealed: row.secretSealed, confirmedAt: row.confirmedAt, lastUsedStep: row.lastUsedStep } : null;
  },
  setPending: async (id, secretSealed) => {
    if (factors.get(id)?.confirmedAt) return;
    factors.set(id, { secretSealed, confirmedAt: null, lastUsedStep: -1, recovery: [] });
  },
  confirm: async (id, secretSealed, step, recoveryHashes, at) => {
    const row = factors.get(id);
    if (!row || row.confirmedAt || row.secretSealed !== secretSealed) return false;
    Object.assign(row, { confirmedAt: at, lastUsedStep: step, recovery: [...recoveryHashes] });
    return true;
  },
  useStep: async (id, step) => {
    const row = factors.get(id);
    if (!row?.confirmedAt || row.lastUsedStep >= step) return false;
    row.lastUsedStep = step;
    return true;
  },
  useRecoveryHash: async (id, code) => {
    const row = factors.get(id);
    if (!row?.confirmedAt || !row.recovery.includes(code)) return false;
    row.recovery = row.recovery.filter((h) => h !== code);
    return true;
  },
  remove: async (id) => factors.delete(id),
};

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value(), exec: async () => value() };
  return q;
};

beforeEach(() => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  users = [
    { _id: OWNER, name: 'Olive', email: 'o@x.test', role: 'admin', adminLevel: 'owner', accountStatus: 'active', tokenVersion: 0, passwordHash: hash, store: null },
    { _id: OPERATOR, name: 'Opa', email: 'p@x.test', role: 'admin', adminLevel: 'operations', accountStatus: 'active', tokenVersion: 0, passwordHash: hash, store: null },
  ];
  audits = [];
  logged = [];
  factors = new Map();
  devices = memoryMobileDeviceStore();
  setAdminMobileDeviceStore(devices);
  setSecondFactorStore(memoryFactors);
  setMinAdminAppVersionLoader(async () => null);
  useMemoryAdminAuthLimits();
  const saved = {
    connect: (mongoose as any).connect,
    findOne: UserModel.findOne,
    findById: UserModel.findById,
    findOneAndUpdate: UserModel.findOneAndUpdate,
    countDocuments: UserModel.countDocuments,
    audit: AuditModel.create,
    steps: adminUserSteps.audit,
    error: console.error,
    log: console.log,
  };
  console.error = (...args: unknown[]) => void logged.push(JSON.stringify(args));
  console.log = (...args: unknown[]) => void logged.push(JSON.stringify(args));
  (mongoose as any).connect = async () => mongoose;
  const byId = (id: string) => users.find((u) => u._id === String(id)) ?? null;
  UserModel.findOne = (filter: any) => chain(() => (filter._id ? byId(filter._id) : (users.find((u) => u.email === filter.email) ?? null)));
  UserModel.findById = (id: string) => chain(() => (byId(id) ? { ...byId(id) } : null));
  UserModel.countDocuments = async () => 1;
  UserModel.findOneAndUpdate = (filter: any, change: any) =>
    chain(() => {
      const user = byId(filter._id);
      if (!user) return null;
      Object.assign(user, change.$set ?? {});
      if (change.$inc?.tokenVersion) user.tokenVersion += change.$inc.tokenVersion;
      return { ...user };
    });
  AuditModel.create = async (doc: any) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  adminUserSteps.audit = async () => undefined;
  restore = () => {
    (mongoose as any).connect = saved.connect;
    Object.assign(UserModel, { findOne: saved.findOne, findById: saved.findById, findOneAndUpdate: saved.findOneAndUpdate, countDocuments: saved.countDocuments });
    AuditModel.create = saved.audit;
    adminUserSteps.audit = saved.steps;
    console.error = saved.error;
    console.log = saved.log;
  };
});

afterEach(() => {
  restore();
  setAdminMobileDeviceStore(null);
  setSecondFactorStore(null);
  setMinAdminAppVersionLoader(null);
});

const request = (url: string, init: { method?: string; body?: unknown; bearer?: string; headers?: Record<string, string> } = {}) =>
  new Request('http://admin.test' + url, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(init.bearer ? { authorization: 'Bearer ' + init.bearer } : {}), ...(init.headers ?? {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

const loginBody = (over: Record<string, unknown> = {}) => ({ email: 'o@x.test', password: PASSWORD, deviceName: 'Pixel', platform: 'android', appVersion: '1.0.0', ...over });
const login = (over: Record<string, unknown> = {}, headers?: Record<string, string>) => routes.login!(request('/api/admin/mobile/v1/auth/login', { body: loginBody(over), headers }));
const refresh = (refreshToken: string) => routes.refresh!(request('/api/admin/mobile/v1/auth/refresh', { body: { refreshToken } }));
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep(Date.now()) + offset);
const json = async (res: Response) => (await res.json()) as any;

// A code is made from the 30 second step of the moment, and the tests use the previous step too (the oldest the server takes). A test that started just
// before a step ended could send a code that is two steps old by the time it is checked, so no test starts in the last seconds of a step.
beforeEach(async () => {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 8_000) await new Promise((resolve) => setTimeout(resolve, left + 50));
});

/** Enrols the account and returns the secret, the recovery codes and the first session. */
async function enrol(email = 'o@x.test') {
  const first = await json(await login({ email }));
  assert.equal(first.code, 'TOTP_ENROLMENT_REQUIRED');
  const secret = first.enrolment.secret as string;
  const res = await login({ email, totp: code(secret, -1) });
  assert.equal(res.status, 200, await res.clone().text());
  return { secret, session: await json(res) };
}

test('a password alone never signs in: first the enrolment, then a code every time; no device exists until a code was checked', async () => {
  const res = await login();
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal(body.code, 'TOTP_ENROLMENT_REQUIRED');
  assert.match(body.enrolment.secret, /^[A-Z2-7]{32}$/);
  assert.ok(body.enrolment.otpauthUri.startsWith('otpauth://totp/Markazify%20Admin:o%40x.test?secret=' + body.enrolment.secret));
  assert.equal(devices.rows.length, 0);
  // Asking again offers the same secret, so a scanned QR stays good.
  assert.equal((await json(await login())).enrolment.secret, body.enrolment.secret);
  assert.equal(factors.get(OWNER)!.secretSealed.includes(body.enrolment.secret), false, 'stored sealed');
  const wrong = await login({ totp: code(body.enrolment.secret) === '000000' ? '000001' : '000000' });
  assert.equal(wrong.status, 401);
  assert.equal((await json(wrong)).code, 'TOTP_INVALID');
  assert.equal(devices.rows.length, 0);
  assert.equal(factors.get(OWNER)!.confirmedAt, null);
});

test('enrolment gives ten recovery codes once, stored as hashes; the session carries the level and its capabilities', async () => {
  const { session } = await enrol();
  assert.equal(session.recoveryCodes.length, 10);
  assert.equal(new Set(session.recoveryCodes).size, 10);
  assert.equal(session.adminLevel, 'owner');
  assert.ok(session.capabilities.includes('users.manage'));
  assert.equal(session.accessTokenExpiresIn, 900);
  const stored = JSON.stringify(factors.get(OWNER));
  for (const recovery of session.recoveryCodes) assert.equal(stored.includes(recovery.replace(/-/g, '')), false);
  assert.equal(devices.rows.length, 1);
  assert.equal(devices.rows[0]!.app, 'admin');
});

test('after enrolment: no factor is TOTP_REQUIRED, a code works once, and no recovery codes come back', async () => {
  const { secret } = await enrol();
  const none = await login();
  assert.equal(none.status, 403);
  assert.equal((await json(none)).code, 'TOTP_REQUIRED');
  const now = code(secret);
  const ok = await login({ totp: now });
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).recoveryCodes, undefined);
  const replay = await login({ totp: now });
  assert.equal(replay.status, 401, 'the same code a second time');
  assert.equal(devices.rows.length, 2);
});

test('a recovery code works exactly once, in any spacing or case', async () => {
  const { session } = await enrol();
  const recovery = session.recoveryCodes[0] as string;
  const ok = await login({ recoveryCode: recovery.toLowerCase().replace(/-/g, ' ') });
  assert.equal(ok.status, 200);
  const again = await login({ recoveryCode: recovery });
  assert.equal(again.status, 401);
  assert.equal((await json(again)).code, 'RECOVERY_CODE_INVALID');
  assert.equal(factors.get(OWNER)!.recovery.length, 9);
  assert.ok(audits.some((a) => a.action === 'mobile.totp_recovery_used'));
});

test('five wrong codes lock the second factor for the account with Retry-After, even for the right code; another account is not locked', async () => {
  const { secret } = await enrol();
  for (let i = 0; i < 5; i += 1) assert.equal((await login({ recoveryCode: 'AAAA-AAAA-AAA' + i })).status, 401);
  const locked = await login({ totp: code(secret) });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.equal((await login({ email: 'p@x.test' })).status, 403, 'the other operator is asked to enrol');
});

test('a wrong password or a suspended operator never reaches the second factor', async () => {
  assert.equal((await login({ password: 'nope' })).status, 401);
  users[0]!.accountStatus = 'suspended';
  assert.equal((await login()).status, 401);
  assert.equal(factors.size, 0);
  users[0]!.accountStatus = 'active';
  users[0]!.adminLevel = 'superuser';
  assert.equal((await login()).status, 403, 'an unknown level has no rights');
  assert.equal(factors.size, 0);
});

test('the phone token passes authorizeAdmin like a console token, with the level read from the account on every request', async () => {
  const { session } = await enrol('p@x.test');
  const phone = request('/x', { method: 'GET', bearer: session.accessToken });
  const web = request('/x', { method: 'GET', bearer: await signSession({ sub: OPERATOR, role: 'admin' }, SECRET, ADMIN_AUDIENCE) });
  assert.deepEqual(await authorizeAdmin(phone, 'sellers.read'), await authorizeAdmin(web, 'sellers.read'));
  for (const capability of ['sellers.read', 'sync.manage', 'payments.decide', 'users.manage', 'tickets.reply'] as const) {
    const outcome = async (r: Request) => authorizeAdmin(r, capability).then(() => 200, (e: { status?: number }) => e.status);
    assert.equal(await outcome(phone), await outcome(web), capability);
  }
  users[1]!.adminLevel = 'finance';
  assert.equal((await authorizeAdmin(phone, 'payments.decide')).adminLevel, 'finance', 'a level change applies at once');
  assert.equal((await routes.me!(request('/api/admin/me', { method: 'GET', bearer: session.accessToken }))).status, 200);
});

test('refresh rotates; a used token ends the family and is audited; a suspended operator is refused and loses the devices', async () => {
  const { secret, session } = await enrol();
  const next = await json(await refresh(session.refreshToken));
  assert.ok(next.accessToken);
  assert.equal((await refresh(session.refreshToken)).status, 401);
  assert.ok(audits.some((a) => a.action === 'mobile.refresh_reuse'));
  assert.equal((await refresh(next.refreshToken)).status, 401);
  const second = await json(await login({ totp: code(secret) }));
  await setAdminStatus(OPERATOR, OWNER, 'suspended', { reason: 'left' });
  assert.ok(devices.rows.every((d) => d.revokedAt !== null));
  assert.equal((await refresh(second.refreshToken)).status, 401);
});

test('list and revoke my own phones; a revoked phone is refused on its next request; another operator\'s phone is a 404', async () => {
  const { secret, session } = await enrol();
  const tablet = await json(await login({ totp: code(secret), deviceName: 'Tablet' }));
  const other = (await enrol('p@x.test')).session;
  const list = await json(await routes.list!(request('/api/admin/mobile/v1/devices', { method: 'GET', bearer: session.accessToken })));
  assert.deepEqual(list.devices.map((d: any) => [d.name, d.current]).sort(), [['Pixel', true], ['Tablet', false]]);
  assert.equal(/hash|family|token/i.test(JSON.stringify(list)), false);
  const revoke = (bearer: string, id: string) => routes.revoke!(request('/x', { bearer }), { params: Promise.resolve({ id }) });
  assert.equal((await revoke(session.accessToken, other.deviceId)).status, 404);
  assert.deepEqual(await json(await revoke(session.accessToken, tablet.deviceId)), { id: tablet.deviceId, revoked: true, changed: true });
  const refused = await routes.me!(request('/api/admin/me', { method: 'GET', bearer: tablet.accessToken }));
  assert.equal(refused.status, 401);
  assert.equal((await json(refused)).code, 'SESSION_REVOKED');
});

test('logout ends the family and is audited', async () => {
  const { session } = await enrol();
  const out = await routes.logout!(request('/api/admin/mobile/v1/auth/logout', { body: { refreshToken: session.refreshToken } }));
  assert.deepEqual(await json(out), { ok: true });
  assert.equal((await refresh(session.refreshToken)).status, 401);
  assert.ok(audits.some((a) => a.action === 'mobile.sign_out'));
});

test('an owner resets a lost second factor: the phones are signed out, the next sign-in enrols again; other levels may not', async () => {
  const { session } = await enrol('p@x.test');
  const reset = async (actor: string, id: string, body: unknown = { reason: 'Lost the phone' }) =>
    routes.reset!(request('/x', { bearer: await signSession({ sub: actor, role: 'admin' }, SECRET, ADMIN_AUDIENCE), body }), { params: Promise.resolve({ id }) });
  assert.equal((await reset(OPERATOR, OWNER)).status, 403);
  assert.equal((await reset(OWNER, OPERATOR, {})).status, 400);
  assert.deepEqual(await json(await reset(OWNER, OPERATOR)), { id: OPERATOR, reset: true, changed: true });
  assert.equal((await refresh(session.refreshToken)).status, 401);
  assert.equal((await json(await login({ email: 'p@x.test' }))).code, 'TOTP_ENROLMENT_REQUIRED');
  const line = audits.find((a) => a.action === 'mobile.totp_reset');
  assert.equal(line.actorId, OWNER);
  assert.equal(line.details.reason, 'Lost the phone');
});

test('the version gate: with a minimum set an older or silent app gets 426 with the store link, on sign-in, refresh and every route', async () => {
  const { session } = await enrol();
  setMinAdminAppVersionLoader(async () => '1.2.0');
  for (const headers of [undefined, { 'x-app-version': '1.1.9', 'x-app-platform': 'android' }, { 'x-app-version': 'abc' }]) {
    const res = await login({}, headers);
    assert.equal(res.status, 426, JSON.stringify(headers));
    const body = await json(res);
    assert.deepEqual([body.code, body.minVersion], ['UPGRADE_REQUIRED', '1.2.0']);
    assert.match(body.storeUrl, /com\.markazify\.admin$/);
  }
  assert.equal((await refresh(session.refreshToken)).status, 426);
  assert.equal(devices.rows[0]!.revokedAt, null, 'an old app keeps its session for after the update');
  assert.equal((await routes.me!(request('/api/admin/me', { method: 'GET', bearer: session.accessToken }))).status, 426);
  assert.equal((await routes.me!(request('/api/admin/me', { method: 'GET', bearer: session.accessToken, headers: { 'x-app-version': '1.2.0' } }))).status, 200);
  assert.equal((await login({}, { 'x-app-version': '2.0.0' })).status, 403, 'a new app goes on to the second factor');
  // The console is not an app: no header is asked of it.
  const web = await signSession({ sub: OWNER, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
  assert.equal((await routes.me!(request('/api/admin/me', { method: 'GET', bearer: web }))).status, 200);
});

test('the audit lines exist and no password, token, secret or code is in a line or a log', async () => {
  const { secret, session } = await enrol();
  const used = code(secret);
  const second = await json(await login({ totp: used }));
  const text = JSON.stringify(audits) + logged.join(' ');
  for (const hidden of [PASSWORD, secret, session.accessToken, session.refreshToken, second.refreshToken, session.recoveryCodes[0], used]) {
    assert.equal(text.includes(hidden), false);
  }
  assert.deepEqual(
    audits.map((a) => a.action),
    ['mobile.totp_enrolled', 'mobile.sign_in', 'mobile.sign_in'],
  );
});

// ------------------------------------------------------------------------------------------------------- push (S9-B3)

const PUSH_TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

test('an admin phone registers its push token; a console session cannot; the switches list the kinds of the level', async () => {
  const { session } = await enrol('p@x.test');
  const registerPush = (await import('../src/app/api/admin/mobile/v1/devices/push-token/route')).POST;
  const settings = await import('../src/app/api/admin/mobile/v1/push-settings/route');
  const ok = await registerPush(request('/x', { bearer: session.accessToken, body: { token: PUSH_TOKEN } }));
  assert.deepEqual(await json(ok), { ok: true, registered: true });
  assert.equal(devices.rows[0]!.pushToken, PUSH_TOKEN);
  const web = await signSession({ sub: OPERATOR, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
  const refused = await registerPush(request('/x', { bearer: web, body: { token: PUSH_TOKEN } }));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused)).code, 'PHONE_ONLY');
  assert.deepEqual((await json(await settings.GET(request('/x', { method: 'GET', bearer: session.accessToken })))).kinds, ['sync_failure']);
  const patched = await settings.PATCH(request('/x', { method: 'PATCH', bearer: session.accessToken, body: { muted: true } }));
  assert.equal(patched.status, 200);
  assert.equal((await settings.PATCH(request('/x', { method: 'PATCH', bearer: session.accessToken, body: { quota: 1 } }))).status, 400);
});

test('a sync failure is pushed to owners and operations, not to finance, at most once an hour', async () => {
  const rows: any[] = [];
  const query = (value: unknown) => ({ select: () => ({ lean: async () => value }) });
  const seen = new Map<string, number>();
  const admins = [
    { _id: 'own', adminLevel: 'owner', accountStatus: 'active', tokenVersion: 0 },
    { _id: 'ops', adminLevel: 'operations', accountStatus: 'active', tokenVersion: 0 },
    { _id: 'fin', adminLevel: 'finance', accountStatus: 'active', tokenVersion: 0 },
  ];
  setAdminPushDeps({
    outbox: { create: async (doc: any) => (rows.push(doc), { _id: 'r' + rows.length }), findOne: () => ({ lean: async () => null }), find: () => ({}) as never, findOneAndUpdate: () => ({ lean: async () => null }) },
    models: {
      devices: { find: (f: any) => query(admins.filter((a) => f.user.$in.includes(a._id)).map((a) => ({ _id: 'd-' + a._id, user: a._id, pushToken: PUSH_TOKEN, tokenVersion: 0 }))) },
      users: { find: (f: any) => query(f.role === 'admin' ? admins : admins.filter((a) => f._id.$in.includes(a._id))) },
      stores: { findById: () => query(null) },
      members: { find: () => query([]) },
    },
    channel: { client: { name: 'fake', send: async () => ({ ok: true }) }, onDeadToken: async () => {} },
    count: async (key) => (seen.set(key, (seen.get(key) ?? 0) + 1), seen.get(key)!),
    schedule: () => {},
  });
  try {
    const at = new Date('2026-11-26T10:15:00Z');
    assert.equal((await pushSyncFailure(3, at))!.queued, 2);
    assert.equal((await pushSyncFailure(5, new Date('2026-11-26T10:45:00Z')))!.queued, 0);
    assert.equal((await pushSyncFailure(1, new Date('2026-11-26T11:01:00Z')))!.queued, 2);
    assert.equal(await pushSyncFailure(0, at), null);
    assert.equal(rows[0].bodyText, '3 sync events could not be delivered.');
  } finally {
    setAdminPushDeps(null);
  }
});

// ------------------------------------------------------------------------------------------------------- actions taken on a phone (S9-B9)

test('a payment decision, a ticket reply and an order view from a phone are audited with the device; the console adds nothing', async () => {
  const { session } = await enrol();
  const { paymentSteps } = await import('@/lib/admin-subscription-payments');
  const { supportSteps } = await import('@/lib/admin-support');
  const { orderSteps } = await import('@/lib/admin-orders');
  const confirm = (await import('../src/app/api/admin/subscription-payments/[id]/confirm/route')).POST;
  const reply = (await import('../src/app/api/admin/tickets/[id]/reply/route')).POST;
  const detail = (await import('../src/app/api/admin/orders/[id]/route')).GET;
  const saved = { confirm: paymentSteps.confirm, reply: supportSteps.reply, detail: orderSteps.detail };
  paymentSteps.confirm = (async () => ({ payment: {} })) as never;
  supportSteps.reply = (async () => ({ ticket: {} })) as never;
  orderSteps.detail = (async () => ({ order: {} })) as never;
  const id = '65c000000000000000000001';
  const context = { params: Promise.resolve({ id }) };
  try {
    const phone = session.accessToken as string;
    const web = await signSession({ sub: OWNER, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
    const device = devices.rows[0]!.id;
    for (const bearer of [phone, web]) {
      audits.length = 0;
      const confirmed = await confirm(request('/x', { bearer, body: { amountRs: 2500, reason: 'Seen in the bank' } }), context);
      assert.equal(confirmed.status, 200, await confirmed.clone().text());
      assert.equal((await reply(request('/x', { bearer, body: { revision: 1, text: 'Done' } }), context)).status, 200);
      assert.equal((await detail(request('/x', { method: 'GET', bearer }), context)).status, 200);
      const seen = Object.fromEntries(audits.map((a) => [a.action, a.details ?? a.metadata ?? a]));
      const text = JSON.stringify(audits);
      if (bearer === phone) {
        assert.ok(seen['subscription_payment.phone_decision'], text);
        assert.equal(audits.length, 3);
        for (const action of ['subscription_payment.phone_decision', 'ticket.reply', 'order.detail_viewed']) {
          assert.ok(JSON.stringify(audits.find((a) => a.action === action)).includes(String(device)), action + ' names the device');
        }
      } else {
        assert.deepEqual(audits.map((a) => a.action).sort(), ['order.detail_viewed', 'ticket.reply']);
        assert.equal(text.includes('device'), false);
      }
    }
  } finally {
    Object.assign(paymentSteps, { confirm: saved.confirm });
    Object.assign(supportSteps, { reply: saved.reply });
    Object.assign(orderSteps, { detail: saved.detail });
  }
});
