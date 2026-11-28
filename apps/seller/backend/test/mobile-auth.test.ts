import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, hashPassword, memoryMobileDeviceStore, Store, User, verifyMobileAccessToken, verifySession, signSession, MOBILE_SELLER_AUDIENCE } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { authenticate, mobileSessionOf } from '@/lib/auth';
import { applyAccountStatus } from '@/lib/account-status';
import { forgetSessionUser, setSessionUserLoader } from '@/lib/session-user';
import { useMemoryAuthLimits } from '@/lib/account-support';
import { setMinSellerAppVersionLoader, setMobileDeviceStore } from '@/lib/mobile-auth';
import { resolveStoreAccess, setMembershipLoader } from '@/lib/data-plane';
import { ROUTE_CAPABILITIES, isCapabilityAccess, routeEntries } from '@/lib/route-capabilities';
import { SELLER_ROLES } from '@/lib/services';

// Sprint 9 (EP-31.US01.T01 to T05): the phone sign-in of the seller backend. Models are stubbed, devices and limiter use their test seams: no database.

const SECRET = 'm'.repeat(40);
const SELLER = '65a000000000000000000001';
const OTHER = '65a000000000000000000002';
const STORE = '65b000000000000000000001';
const FOREIGN = '65b000000000000000000002';
const PASSWORD = 'correct-horse-battery';
const EMAIL = 'ayesha@example.com';

const UserModel = User as any;
const AuditModel = AuditLog as any;
const StoreModel = Store as any;

type Account = { role: string; accountStatus: 'active' | 'suspended' | 'blocked'; tokenVersion: number; emailVerifiedAt: Date | null };
let account: Account;
let stored: Record<string, any>;
let baseHash = '';
let devices: ReturnType<typeof memoryMobileDeviceStore>;
let memory: ReturnType<typeof useMemoryAuthLimits>;
let logged: string[] = [];
let restore: () => void = () => {};
let routes: Record<string, (r: any, c?: any) => Promise<Response>> = {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  routes = {
    login: (await import('../src/app/api/mobile/v1/auth/login/route')).POST,
    refresh: (await import('../src/app/api/mobile/v1/auth/refresh/route')).POST,
    logout: (await import('../src/app/api/mobile/v1/auth/logout/route')).POST,
    list: (await import('../src/app/api/mobile/v1/devices/route')).GET,
    revoke: (await import('../src/app/api/mobile/v1/devices/[id]/revoke/route')).POST,
    password: (await import('../src/app/api/users/me/password/route')).POST,
    signOutOthers: (await import('../src/app/api/users/me/sessions/revoke-others/route')).POST,
    webLogin: (await import('../src/app/api/users/login/route')).POST,
  } as typeof routes;
  baseHash = await hashPassword(PASSWORD);
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value(), exec: async () => value() };
  return q;
};

beforeEach(() => {
  account = { role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: null };
  stored = { _id: SELLER, name: 'Ayesha', email: EMAIL, role: 'seller', passwordHash: baseHash, tokenVersion: 0 };
  setSessionUserLoader(async (id) => (id === SELLER ? { ...account } : null), { ttlMs: 0 });
  devices = memoryMobileDeviceStore();
  setMobileDeviceStore(devices);
  memory = useMemoryAuthLimits();
  logged = [];
  const saved = {
    connect: (mongoose as any).connect,
    user: Object.fromEntries(['findById', 'findOne', 'findOneAndUpdate', 'updateOne'].map((m) => [m, UserModel[m]])),
    audit: AuditModel.create,
    exists: StoreModel.exists,
    findStore: StoreModel.findOne,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  console.error = (...args: unknown[]) => void logged.push(JSON.stringify(args));
  console.log = (...args: unknown[]) => void logged.push(JSON.stringify(args));
  console.warn = (...args: unknown[]) => void logged.push(JSON.stringify(args));
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => chain(() => ({ ...stored }));
  UserModel.findOne = (filter: any) => chain(() => (filter.email === stored.email || filter._id === SELLER ? { ...stored, accountStatus: account.accountStatus } : null));
  UserModel.updateOne = async () => ({ matchedCount: 1, modifiedCount: 1 });
  UserModel.findOneAndUpdate = (_filter: any, update: any) =>
    chain(() => {
      Object.assign(stored, update.$set ?? {});
      for (const [k, by] of Object.entries(update.$inc ?? {})) stored[k] = (stored[k] ?? 0) + (by as number);
      account.tokenVersion = stored.tokenVersion;
      if (update.$set?.accountStatus) account.accountStatus = update.$set.accountStatus;
      return { ...stored };
    });
  AuditModel.create = async () => ({ _id: new mongoose.Types.ObjectId() });
  StoreModel.exists = async (filter: any) => (filter._id === STORE && String(filter.owner) === SELLER ? { _id: STORE } : null);
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.user)) UserModel[m] = fn;
    AuditModel.create = saved.audit;
    StoreModel.exists = saved.exists;
    StoreModel.findOne = saved.findStore;
    console.error = saved.error;
    console.log = saved.log;
    console.warn = saved.warn;
  };
});

afterEach(() => {
  restore();
  setSessionUserLoader(null);
  setMobileDeviceStore(null);
  setMembershipLoader(null);
  delete process.env.TRUSTED_CLIENT_IP_HEADER;
});

const req = (url: string, init: { method?: string; body?: unknown; bearer?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest('http://seller.test' + url, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(init.bearer ? { authorization: 'Bearer ' + init.bearer } : {}), ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });

const loginBody = (over: Record<string, unknown> = {}) => ({ email: EMAIL, password: PASSWORD, deviceName: 'Galaxy A54', platform: 'android', appVersion: '1.0.0', ...over });
const login = (over: Record<string, unknown> = {}, headers?: Record<string, string>) => routes.login!(req('/api/mobile/v1/auth/login', { body: loginBody(over), headers }));
const refresh = (refreshToken: string) => routes.refresh!(req('/api/mobile/v1/auth/refresh', { body: { refreshToken } }));
const logout = (refreshToken: string) => routes.logout!(req('/api/mobile/v1/auth/logout', { body: { refreshToken } }));
const listDevices = (bearer: string) => routes.list!(req('/api/mobile/v1/devices', { method: 'GET', bearer }));
const revokeDevice = (bearer: string, id: string) => routes.revoke!(req('/api/mobile/v1/devices/' + id + '/revoke', { bearer }), { params: Promise.resolve({ id }) });

interface Session {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
}
async function signedIn(over: Record<string, unknown> = {}): Promise<Session> {
  const res = await login(over);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Session;
}
const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code;
async function rejectionOf(promise: Promise<unknown>): Promise<{ status?: number; code?: string } | 'accepted'> {
  try {
    await promise;
  } catch (err) {
    const e = err as { status?: number; errorCode?: string; code?: string };
    return { status: e.status, code: e.errorCode ?? e.code };
  }
  return 'accepted';
}
const authed = (bearer: string) => authenticate(req('/x', { method: 'GET', bearer }));

// ------------------------------------------------------------------------------------------------------- login (T01)

test('login answers a 15 minute access token, a 30 day refresh token and one device; the refresh token is stored as a hash only', async () => {
  const res = await login();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as any;
  assert.equal(body.accessTokenExpiresIn, 900);
  const days = (new Date(body.refreshTokenExpiresAt).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30, String(days));
  assert.equal(body.user.id, SELLER);
  assert.equal(body.user.emailVerified, false);
  assert.equal(body.token, undefined, 'no web session is handed out');
  const claims = await verifyMobileAccessToken(body.accessToken, SECRET, MOBILE_SELLER_AUDIENCE);
  assert.equal(claims.sub, SELLER);
  await assert.rejects(verifySession(body.accessToken, SECRET, SELLER_AUDIENCE), 'a phone token is not a web session');
  assert.equal(devices.rows.length, 1);
  const row = devices.rows[0]!;
  assert.equal(row.refreshHash, createHash('sha256').update(body.refreshToken).digest('hex'));
  assert.equal(JSON.stringify(row).includes(body.refreshToken), false);
  assert.equal(row.family, claims.fam);
  assert.equal(row.name, 'Galaxy A54');
});

test('login: a wrong password, an unknown email, a suspended account and an operator account get the same 401; a bad body names the field', async () => {
  const wrong = await login({ password: 'wrong-password' });
  const unknown = await login({ email: 'nobody@example.com' });
  account.accountStatus = 'suspended';
  const suspended = await login();
  account.accountStatus = 'active';
  stored.role = 'admin';
  const operator = await login();
  assert.deepEqual([wrong.status, unknown.status, suspended.status, operator.status], [401, 401, 401, 401]);
  assert.equal(new Set(await Promise.all([wrong, unknown, suspended, operator].map((r) => r.text()))).size, 1);
  assert.equal(devices.rows.length, 0);
  for (const [over, field] of [[{ platform: 'ios' }, 'platform'], [{ appVersion: 'one' }, 'appVersion'], [{ deviceName: '' }, 'deviceName'], [{ extra: 1 }, 'extra']] as const) {
    const res = await login(over);
    assert.equal(res.status, 400, field);
    assert.equal(((await res.json()) as { field: string }).field, field);
  }
});

test('signing in again with the same installationId replaces that phone, another installation is a second device', async () => {
  const first = await signedIn({ installationId: 'install-aaaa-1111' });
  await signedIn({ installationId: 'install-aaaa-1111' });
  await signedIn({ installationId: 'install-bbbb-2222' });
  assert.equal(devices.rows.filter((r) => r.revokedAt === null).length, 2);
  assert.equal(await codeOf(await refresh(first.refreshToken)), 'SESSION_REVOKED');
});

// ------------------------------------------------------------------------------------------------ refresh and logout (T02)

test('refresh rotates both tokens, and the new refresh token works', async () => {
  const session = await signedIn();
  const res = await refresh(session.refreshToken);
  assert.equal(res.status, 200);
  const next = (await res.json()) as Session;
  assert.notEqual(next.refreshToken, session.refreshToken);
  assert.equal((await authed(next.accessToken)).userId, SELLER);
  assert.equal((await refresh(next.refreshToken)).status, 200);
});

test('a refresh token used twice ends the whole family: the newer tokens stop working too', async () => {
  const session = await signedIn();
  const next = (await (await refresh(session.refreshToken)).json()) as Session;
  const reused = await refresh(session.refreshToken);
  assert.equal(reused.status, 401);
  assert.equal(await codeOf(reused), 'SESSION_REVOKED');
  assert.equal(devices.rows[0]!.revokedReason, 'refresh_reuse');
  assert.equal((await refresh(next.refreshToken)).status, 401, 'the rightful holder must sign in again');
  assert.deepEqual(await rejectionOf(authed(next.accessToken)), { status: 401, code: 'SESSION_REVOKED' });
});

test('two refreshes of one token at the same moment: one wins, and the family is ended', async () => {
  const session = await signedIn();
  const results = await Promise.all([refresh(session.refreshToken), refresh(session.refreshToken)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal(devices.rows[0]!.revokedReason, 'refresh_reuse');
});

test('a made-up or altered refresh token is refused and ends nothing', async () => {
  const session = await signedIn();
  const family = devices.rows[0]!.family;
  for (const bad of ['garbage', 'mzr1.' + family + '.abc.def', session.refreshToken.slice(0, -2) + 'AA', session.refreshToken + 'x']) {
    assert.equal((await refresh(bad)).status, 401, bad.slice(0, 12));
  }
  assert.equal(devices.rows[0]!.revokedAt, null);
  assert.equal((await refresh(session.refreshToken)).status, 200);
});

test('an expired refresh token is refused', async () => {
  const session = await signedIn();
  devices.rows[0]!.refreshExpiresAt = new Date(Date.now() - 1000);
  assert.equal((await refresh(session.refreshToken)).status, 401);
  assert.deepEqual(await rejectionOf(authed(session.accessToken)), { status: 401, code: 'SESSION_REVOKED' });
});

test('logout ends the family; any token gets the same 200', async () => {
  const session = await signedIn();
  const out = await logout(session.refreshToken);
  assert.equal(out.status, 200);
  assert.deepEqual(await out.json(), { ok: true });
  assert.deepEqual(await (await logout('garbage')).json(), { ok: true });
  assert.equal(devices.rows[0]!.revokedReason, 'logout');
  assert.equal((await refresh(session.refreshToken)).status, 401);
  assert.deepEqual(await rejectionOf(authed(session.accessToken)), { status: 401, code: 'SESSION_REVOKED' });
});

test('a password change on the website ends every phone session, at once and at the refresh', async () => {
  const phone = await signedIn();
  const tablet = await signedIn({ deviceName: 'Tablet' });
  const web = await signSession({ sub: SELLER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  const res = await routes.password!(req('/api/users/me/password', { bearer: web, body: { currentPassword: PASSWORD, newPassword: 'another-password-9' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(devices.rows.map((r) => r.revokedReason), ['password_changed', 'password_changed']);
  assert.equal((await refresh(phone.refreshToken)).status, 401);
  assert.notEqual(await rejectionOf(authed(tablet.accessToken)), 'accepted');
});

test('a password reset elsewhere (only tokenVersion moves) is caught: access refused, refresh refused, the rows closed', async () => {
  const session = await signedIn();
  const second = await signedIn({ deviceName: 'Second' });
  account.tokenVersion = 1;
  forgetSessionUser(SELLER);
  assert.deepEqual(await rejectionOf(authed(session.accessToken)), { status: undefined, code: 'SESSION_REVOKED' });
  assert.equal((await refresh(session.refreshToken)).status, 401);
  assert.ok(devices.rows.every((r) => r.revokedReason === 'password_changed'));
  assert.equal((await refresh(second.refreshToken)).status, 401);
});

test('a suspended account: the refresh answers ACCOUNT_SUSPENDED and every family ends', async () => {
  const session = await signedIn();
  await signedIn({ deviceName: 'Second' });
  account.accountStatus = 'suspended';
  const res = await refresh(session.refreshToken);
  assert.equal(res.status, 401);
  assert.equal(await codeOf(res), 'ACCOUNT_SUSPENDED');
  assert.ok(devices.rows.every((r) => r.revokedReason === 'account_disabled'));
});

test('suspending a seller (the admin bridge) ends the phone sessions, and enabling again does not bring them back', async () => {
  const session = await signedIn();
  await applyAccountStatus({ userId: SELLER, status: 'suspended', reason: 'fraud' }, 'admin1');
  assert.equal(devices.rows[0]!.revokedReason, 'account_disabled');
  account.accountStatus = 'active';
  assert.equal((await refresh(session.refreshToken)).status, 401);
});

test('a phone token never becomes a web session: password change and sign-out-everywhere refuse it and write nothing', async () => {
  const session = await signedIn();
  const others = await routes.signOutOthers!(req('/api/users/me/sessions/revoke-others', { bearer: session.accessToken }));
  assert.equal(others.status, 403);
  assert.equal(await codeOf(others), 'WEB_SESSION_REQUIRED');
  const change = await routes.password!(req('/api/users/me/password', { bearer: session.accessToken, body: { currentPassword: PASSWORD, newPassword: 'another-password-9' } }));
  assert.equal(change.status, 403);
  assert.equal(stored.tokenVersion, 0);
  assert.equal(stored.passwordHash, baseHash);
  assert.equal(devices.rows[0]!.revokedAt, null);
});

// ------------------------------------------------------------------------------------------------------- devices (T03)

test('the device list shows my live phones, marks the current one, and carries no token or hash', async () => {
  const phone = await signedIn();
  await signedIn({ deviceName: 'Tablet' });
  const dead = await signedIn({ deviceName: 'Old' });
  await logout(dead.refreshToken);
  await devices.create({ app: 'seller', user: OTHER, family: 'o'.repeat(24), name: 'Stranger', platform: 'android', appVersion: '1.0.0', installationId: null, refreshHash: 'f'.repeat(64), refreshExpiresAt: new Date(Date.now() + 60_000), tokenVersion: 0, lastSeenAt: new Date() });
  const res = await listDevices(phone.accessToken);
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text) as { devices: Array<{ id: string; name: string; current: boolean }> };
  assert.deepEqual(body.devices.map((d) => d.name).sort(), ['Galaxy A54', 'Tablet']);
  assert.deepEqual(body.devices.filter((d) => d.current).map((d) => d.id), [phone.deviceId]);
  assert.equal(/refresh|family|hash|token/i.test(text), false, text);
  const web = await signSession({ sub: SELLER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  const fromWeb = (await (await listDevices(web)).json()) as { devices: Array<{ current: boolean }> };
  assert.equal(fromWeb.devices.length, 2);
  assert.ok(fromWeb.devices.every((d) => !d.current));
});

test('revoking a device stops it at once; a second revoke changes nothing; another account\'s device and a bad id are 404', async () => {
  const phone = await signedIn();
  const tablet = await signedIn({ deviceName: 'Tablet' });
  const first = await revokeDevice(phone.accessToken, tablet.deviceId);
  assert.deepEqual(await first.json(), { id: tablet.deviceId, revoked: true, changed: true });
  assert.deepEqual(await (await revokeDevice(phone.accessToken, tablet.deviceId)).json(), { id: tablet.deviceId, revoked: true, changed: false });
  assert.deepEqual(await rejectionOf(authed(tablet.accessToken)), { status: 401, code: 'SESSION_REVOKED' });
  assert.equal((await refresh(tablet.refreshToken)).status, 401);
  const { id: foreign } = await devices.create({ app: 'seller', user: OTHER, family: 'p'.repeat(24), name: 'Stranger', platform: 'android', appVersion: '1.0.0', installationId: null, refreshHash: 'f'.repeat(64), refreshExpiresAt: new Date(Date.now() + 60_000), tokenVersion: 0, lastSeenAt: new Date() });
  assert.equal((await revokeDevice(phone.accessToken, foreign)).status, 404);
  assert.equal(devices.rows.find((r) => r.id === foreign)!.revokedAt, null);
  assert.equal((await revokeDevice(phone.accessToken, 'nonsense')).status, 404);
});

// ------------------------------------------------------------------------------------------------ authenticate (T04)

test('a bearer phone request produces the same request context as a web session', async () => {
  const phone = await signedIn();
  const web = await signSession({ sub: SELLER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  const fromPhone = await authed(phone.accessToken);
  const fromWeb = await authenticate(new NextRequest('http://seller.test/x', { headers: { cookie: 'markaz-session=' + web } }));
  assert.deepEqual(fromPhone, fromWeb);
  assert.deepEqual(Object.keys(fromPhone).sort(), Object.keys(fromWeb).sort());
  assert.deepEqual(mobileSessionOf(fromPhone), { deviceId: phone.deviceId });
  assert.equal(mobileSessionOf(fromWeb), undefined);
});

test('a phone token is accepted from the Authorization Bearer header only: not from the cookie, not as "JWT", not with another secret or audience', async () => {
  const phone = await signedIn();
  const bad = [
    new NextRequest('http://seller.test/x', { headers: { cookie: 'markaz-session=' + phone.accessToken } }),
    new NextRequest('http://seller.test/x', { headers: { authorization: 'JWT ' + phone.accessToken } }),
    req('/x', { bearer: phone.refreshToken }),
    req('/x', { bearer: phone.accessToken.slice(0, -3) + 'aaa' }),
  ];
  for (const request of bad) assert.deepEqual(await rejectionOf(authenticate(request)), { status: 401, code: undefined });
});

const outcome = async (request: NextRequest, capability: string): Promise<string> => {
  const ctx = await authenticate(request);
  try {
    const access = await resolveStoreAccess(request, ctx, null, { capability: capability as never });
    return 'ok:' + access.role + ':' + access.isOwner + ':' + ctx.storeRole;
  } catch (err) {
    const e = err as { status?: number; errorCode?: string };
    return 'refused:' + e.status + ':' + (e.errorCode ?? '');
  }
};

test('parity: for every role and every route of the capability map, a phone is answered exactly like the web, in its own store and in a foreign one', async () => {
  const phone = await signedIn();
  const web = await signSession({ sub: SELLER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  const capabilities = [...new Set(routeEntries().map(([, access]) => access).filter(isCapabilityAccess))];
  assert.ok(capabilities.length > 20);
  const answers = new Map<string, string>();
  for (const role of SELLER_ROLES) {
    const owner = role === 'owner';
    StoreModel.exists = async (filter: any) => (owner && filter._id === STORE ? { _id: STORE } : null);
    setMembershipLoader(async (storeId) => (storeId === STORE && !owner ? { role } : null));
    for (const capability of capabilities) {
      for (const store of [STORE, FOREIGN]) {
        const headers = { 'x-store-id': store };
        const fromWeb = await outcome(new NextRequest('http://seller.test/x', { headers: { ...headers, cookie: 'markaz-session=' + web } }), capability);
        const fromPhone = await outcome(req('/x', { method: 'GET', bearer: phone.accessToken, headers }), capability);
        assert.equal(fromPhone, fromWeb, role + ' ' + capability + ' ' + store);
        if (store === FOREIGN) assert.equal(fromPhone, 'refused:403:', role + ' ' + capability);
        answers.set(role + ' ' + capability, store === STORE ? fromPhone : (answers.get(role + ' ' + capability) ?? ''));
      }
    }
  }
  // Every route that serves a store is covered by one of those capabilities, and the roles really differ.
  for (const [key, access] of Object.entries(ROUTE_CAPABILITIES)) if (isCapabilityAccess(access)) assert.ok(capabilities.includes(access), key);
  assert.match(answers.get('owner team.manage')!, /^ok:owner:true/);
  assert.match(answers.get('support team.manage')!, /^refused:403/);
  assert.match(answers.get('support orders.read')!, /^ok:support:false/);
});

// ------------------------------------------------------------------------------------------- limits and secrets (T05)

const FIFTEEN = 15 * 60 * 1000;
const windowKey = (rule: string, subject: string) =>
  'auth:' + rule + ':' + createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 32) + ':' + Math.floor(Date.now() / FIFTEEN) * FIFTEEN;

test('10 wrong passwords lock the account for the phone and the web alike, with Retry-After, before any password check', async () => {
  for (let i = 0; i < 10; i += 1) assert.equal((await login({ password: 'wrong-' + i })).status, 401);
  const locked = await login();
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  const web = await routes.webLogin!(req('/api/users/login', { body: { email: EMAIL, password: PASSWORD } }));
  assert.equal(web.status, 429, 'one shared counter: a phone is not a second way to guess');
  assert.equal(devices.rows.length, 0);
});

test('30 failures from one client address lock that address, another address still gets through', async () => {
  process.env.TRUSTED_CLIENT_IP_HEADER = 'x-test-client-ip';
  memory.counts.set(windowKey('login-ip', '203.0.113.7'), 30);
  assert.equal((await login({}, { 'x-test-client-ip': '203.0.113.7' })).status, 429);
  assert.equal((await login({}, { 'x-test-client-ip': '198.51.100.9' })).status, 200);
});

test('no password or token appears in an error answer or in a log line', async () => {
  const session = await signedIn();
  const next = (await (await refresh(session.refreshToken)).json()) as Session;
  const texts = [
    await (await login({ password: 'secret-wrong-password' })).text(),
    await (await refresh(session.refreshToken)).text(),
    await (await refresh(next.refreshToken)).text(),
  ].join(' ');
  const all = texts + ' ' + logged.join(' ');
  for (const secret of [PASSWORD, 'secret-wrong-password', SECRET, session.refreshToken, session.accessToken, next.refreshToken, next.accessToken]) {
    assert.equal(all.includes(secret), false);
  }
});

test('without SELLER_AUTH_SECRET the sign-in is a 503 and nothing is created', async () => {
  delete process.env.SELLER_AUTH_SECRET;
  try {
    assert.equal((await login()).status, 503);
    assert.equal(devices.rows.length, 0);
  } finally {
    process.env.SELLER_AUTH_SECRET = SECRET;
  }
});

// ------------------------------------------------------------------------------------- version gate and audit (S9-B2)

test('the version gate: with a minimum set an older or silent app gets 426 with the store link on sign-in, refresh and every bearer route, and keeps its session', async () => {
  const session = await signedIn();
  setMinSellerAppVersionLoader(async () => '1.2.0');
  try {
    const headers: Array<Record<string, string> | undefined> = [undefined, { 'x-app-version': '1.1.0', 'x-app-platform': 'android' }];
    for (const sent of headers) {
      const res = await login({}, sent);
      assert.equal(res.status, 426);
      const body = (await res.json()) as { code: string; minVersion: string; storeUrl: string };
      assert.deepEqual([body.code, body.minVersion], ['UPGRADE_REQUIRED', '1.2.0']);
      assert.match(body.storeUrl, /com\.markazify\.seller$/);
    }
    assert.equal((await refresh(session.refreshToken)).status, 426);
    assert.equal((await listDevices(session.accessToken)).status, 426);
    assert.equal(devices.rows[0]!.revokedAt, null);
    assert.equal((await login({}, { 'x-app-version': '1.2.0' })).status, 200);
    // The web portal is not an app: nothing is asked of a cookie or session request.
    const web = await signSession({ sub: SELLER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
    assert.equal((await listDevices(web)).status, 200);
  } finally {
    setMinSellerAppVersionLoader(null);
  }
  assert.equal((await refresh(session.refreshToken)).status, 200, 'the same refresh token works after the update');
});

test('audit lines: sign-in, refresh reuse, sign-out and device revoke, with no token in any of them', async () => {
  const lines: any[] = [];
  AuditModel.create = async (doc: unknown) => {
    lines.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  const first = await signedIn();
  const second = await signedIn({ deviceName: 'Tablet' });
  await revokeDevice(first.accessToken, second.deviceId);
  await refresh(first.refreshToken);
  await refresh(first.refreshToken);
  const third = await signedIn({ deviceName: 'Third' });
  await logout(third.refreshToken);
  assert.deepEqual(lines.map((l) => l.action), ['mobile.sign_in', 'mobile.sign_in', 'mobile.device_revoked', 'mobile.refresh_reuse', 'mobile.sign_in', 'mobile.sign_out']);
  const text = JSON.stringify(lines);
  for (const token of [first.accessToken, first.refreshToken, second.refreshToken, third.refreshToken, PASSWORD]) assert.equal(text.includes(token), false);
  assert.ok(lines.every((l) => l.actorId === 'seller:' + SELLER));
});

test('a failing audit write never breaks the sign-in', async () => {
  AuditModel.create = async () => {
    throw new Error('audit is down');
  };
  assert.equal((await login()).status, 200);
});
