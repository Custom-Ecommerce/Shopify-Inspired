import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, AuthToken, hashPassword, signSession, User, verifySession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { forgetSessionUser, setSessionUserLoader } from '@/lib/session-user';
import { requireVerifiedEmail, useMemoryAuthLimits } from '@/lib/account-support';
import { HttpError } from '@/lib/http';

// Sprint 4 EP-08 (D-093): the session guard in authenticate, the account routes and the login throttle. Models are
// stubbed, the session loader and the limiter use their test seams; no database, no email.

const SECRET = 'x'.repeat(40);
const SELLER = '65a000000000000000000001';
const PASSWORD = 'correct-horse-battery';

const UserModel = User as any;
const TokenModel = AuthToken as any;
const AuditModel = AuditLog as any;

type Account = { role: string; accountStatus: 'active' | 'suspended' | 'blocked'; tokenVersion: number; emailVerifiedAt: Date | null };
let account: Account;
let reads = 0;
let stored: Record<string, any>;
let audits: unknown[] = [];
let memory: ReturnType<typeof useMemoryAuthLimits>;
let restore: () => void = () => {};

let routes: Record<string, (r: NextRequest) => Promise<Response>> = {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  routes = {
    forgot: (await import('../src/app/api/auth/forgot-password/route')).POST,
    reset: (await import('../src/app/api/auth/reset-password/route')).POST,
    resend: (await import('../src/app/api/auth/resend-verification/route')).POST,
    login: (await import('../src/app/api/users/login/route')).POST,
    profile: (await import('../src/app/api/users/me/route')).PATCH,
    password: (await import('../src/app/api/users/me/password/route')).POST,
    email: (await import('../src/app/api/users/me/email/route')).POST,
    revoke: (await import('../src/app/api/users/me/sessions/revoke-others/route')).POST,
  } as Record<string, (r: NextRequest) => Promise<Response>>;
  stored = { _id: SELLER, name: 'Ayesha', email: 'ayesha@example.com', role: 'seller', passwordHash: await hashPassword(PASSWORD), tokenVersion: 0, loginAttempts: 0, lockUntil: null };
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value(), exec: async () => value() };
  return q;
};

beforeEach(() => {
  account = { role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: null };
  reads = 0;
  audits = [];
  stored = { ...stored, name: 'Ayesha', email: 'ayesha@example.com', tokenVersion: 0, pendingEmail: null, emailVerifiedAt: null, phone: null };
  setSessionUserLoader(async () => {
    reads += 1;
    return { ...account };
  });
  memory = useMemoryAuthLimits();
  const saved = {
    connect: (mongoose as any).connect,
    user: Object.fromEntries(['findById', 'findOne', 'findOneAndUpdate', 'updateOne'].map((m) => [m, UserModel[m]])),
    token: Object.fromEntries(['findOneAndUpdate', 'updateMany', 'create'].map((m) => [m, TokenModel[m]])),
    audit: AuditModel.create,
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => chain(() => ({ ...stored }));
  UserModel.findOne = (filter: any) => chain(() => (filter.email === stored.email ? { ...stored } : null));
  UserModel.updateOne = async () => ({ matchedCount: 1, modifiedCount: 1 });
  UserModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const tvFilter = filter.tokenVersion;
      if (tvFilter !== undefined) {
        const ok = typeof tvFilter === 'object' ? tvFilter.$in.includes(stored.tokenVersion ?? null) : tvFilter === stored.tokenVersion;
        if (!ok) return null;
      }
      Object.assign(stored, update.$set ?? {});
      for (const [k, by] of Object.entries(update.$inc ?? {})) stored[k] = (stored[k] ?? 0) + (by as number);
      account.tokenVersion = stored.tokenVersion;
      return { ...stored };
    });
  TokenModel.findOneAndUpdate = () => chain(() => null);
  TokenModel.updateMany = async () => ({});
  TokenModel.create = async (doc: unknown) => doc;
  AuditModel.create = async (doc: unknown) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.user)) UserModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.token)) TokenModel[m] = fn;
    AuditModel.create = saved.audit;
  };
});

afterEach(() => {
  restore();
  setSessionUserLoader(null);
});

const token = (tv?: number) => signSession({ sub: SELLER, role: 'seller', ...(tv === undefined ? {} : { tv }) }, SECRET, SELLER_AUDIENCE);
const req = (url: string, init: { method?: string; body?: unknown; bearer?: string } = {}) =>
  new NextRequest('http://seller.test' + url, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(init.bearer ? { authorization: 'Bearer ' + init.bearer } : {}) },
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return 'accepted';
}

// ------------------------------------------------------------------------------------------- session guard (US03.T01)

test('authenticate refuses a suspended or blocked account and an older token version, with clear codes', async () => {
  account.accountStatus = 'suspended';
  assert.equal(await codeOf(authenticate(req('/x', { bearer: await token() }))), 'ACCOUNT_SUSPENDED');
  forgetSessionUser(SELLER);
  account.accountStatus = 'blocked';
  assert.equal(await codeOf(authenticate(req('/x', { bearer: await token() }))), 'ACCOUNT_SUSPENDED');
  forgetSessionUser(SELLER);
  account = { ...account, accountStatus: 'active', tokenVersion: 2 };
  assert.equal(await codeOf(authenticate(req('/x', { bearer: await token(1) }))), 'SESSION_REVOKED');
  const ctx = await authenticate(req('/x', { bearer: await token(2) }));
  assert.equal(ctx.tokenVersion, 2);
});

test('a token from before tv existed still works while the account is at version 0', async () => {
  const ctx = await authenticate(req('/x', { bearer: await token() }));
  assert.equal(ctx.userId, SELLER);
  assert.equal(ctx.emailVerified, false);
});

test('the account is cached, and forgetSessionUser makes a suspension count at once', async () => {
  const bearer = await token();
  await authenticate(req('/x', { bearer }));
  await authenticate(req('/x', { bearer }));
  assert.equal(reads, 1, 'the second request is served from the cache');
  account.accountStatus = 'suspended';
  forgetSessionUser(SELLER);
  assert.equal(await codeOf(authenticate(req('/x', { bearer }))), 'ACCOUNT_SUSPENDED');
});

test('a refused session answers 401 with the code on a route', async () => {
  account.accountStatus = 'suspended';
  const response = await routes.revoke!(req('/api/users/me/sessions/revoke-others', { bearer: await token() }));
  assert.equal(response.status, 401);
  assert.equal(((await response.json()) as { code: string }).code, 'ACCOUNT_SUSPENDED');
});

test('requireVerifiedEmail refuses an unverified account with 403 EMAIL_NOT_VERIFIED', async () => {
  const ctx = await authenticate(req('/x', { bearer: await token() }));
  await assert.rejects(requireVerifiedEmail(ctx), (err: unknown) => err instanceof HttpError && err.status === 403 && err.errorCode === 'EMAIL_NOT_VERIFIED');
  await requireVerifiedEmail({ ...ctx, emailVerified: true });
  stored.emailVerifiedAt = new Date();
  await requireVerifiedEmail({ ...ctx, emailVerified: undefined });
});

// --------------------------------------------------------------------------------------------- forgot / reset (US01)

test('forgot password answers exactly the same for a known and an unknown email', async () => {
  const known = await routes.forgot!(req('/api/auth/forgot-password', { body: { email: 'ayesha@example.com' } }));
  const unknown = await routes.forgot!(req('/api/auth/forgot-password', { body: { email: 'nobody@example.com' } }));
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
});

test('forgot password is limited to 3 an hour per email, with Retry-After', async () => {
  for (let i = 0; i < 3; i += 1) assert.equal((await routes.forgot!(req('/api/auth/forgot-password', { body: { email: 'z@example.com' } }))).status, 200);
  const limited = await routes.forgot!(req('/api/auth/forgot-password', { body: { email: 'z@example.com' } }));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('reset with an unknown, used or expired token is 400 TOKEN_INVALID; a short password names the field', async () => {
  const bad = await routes.reset!(req('/api/auth/reset-password', { body: { token: 'a'.repeat(43), password: 'long-enough-1' } }));
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, 'TOKEN_INVALID');
  const short = await routes.reset!(req('/api/auth/reset-password', { body: { token: 'a'.repeat(43), password: 'short' } }));
  assert.equal(short.status, 400);
  assert.equal(((await short.json()) as { field: string }).field, 'password');
});

test('reset with a valid token stores the new hash and bumps tokenVersion (old sessions end)', async () => {
  TokenModel.findOneAndUpdate = () => chain(() => ({ user: SELLER, kind: 'password_reset', newEmail: null }));
  const response = await routes.reset!(req('/api/auth/reset-password', { body: { token: 'b'.repeat(43), password: 'brand-new-password' } }));
  assert.equal(response.status, 200);
  assert.equal(stored.tokenVersion, 1);
  assert.notEqual(stored.passwordHash, undefined);
  forgetSessionUser(SELLER);
  assert.equal(await codeOf(authenticate(req('/x', { bearer: await token() }))), 'SESSION_REVOKED');
});

// ------------------------------------------------------------------------------------------- verification (US02)

test('resend verification: 3 an hour per account, and nothing for a verified account', async () => {
  const bearer = await token();
  for (let i = 0; i < 3; i += 1) assert.deepEqual(await (await routes.resend!(req('/api/auth/resend-verification', { bearer }))).json(), { sent: true });
  assert.equal((await routes.resend!(req('/api/auth/resend-verification', { bearer }))).status, 429);
  stored.emailVerifiedAt = new Date();
  assert.deepEqual(await (await routes.resend!(req('/api/auth/resend-verification', { bearer }))).json(), { sent: false });
});

// ------------------------------------------------------------------------------------------------ account (US04)

test('profile: name and phone are saved, the phone follows the shared rule, an unknown field is named', async () => {
  const bearer = await token();
  const ok = await routes.profile!(req('/api/users/me', { method: 'PATCH', bearer, body: { name: 'Ayesha Khan', phone: '0300 1234567' } }));
  assert.equal(ok.status, 200);
  assert.deepEqual(((await ok.json()) as { user: unknown }).user, { id: SELLER, name: 'Ayesha Khan', phone: '+923001234567' });
  const badPhone = await routes.profile!(req('/api/users/me', { method: 'PATCH', bearer, body: { phone: '12345' } }));
  assert.equal(((await badPhone.json()) as { field: string }).field, 'phone');
  const unknown = await routes.profile!(req('/api/users/me', { method: 'PATCH', bearer, body: { email: 'x@example.com' } }));
  assert.equal(unknown.status, 400);
  assert.equal(((await unknown.json()) as { field: string }).field, 'email');
});

test('password change: a wrong current password is refused; a right one bumps tokenVersion and returns a working token', async () => {
  const bearer = await token();
  const wrong = await routes.password!(req('/api/users/me/password', { bearer, body: { currentPassword: 'nope', newPassword: 'another-password' } }));
  assert.equal(wrong.status, 400);
  assert.deepEqual((({ code, field }) => ({ code, field }))((await wrong.json()) as { code: string; field: string }), { code: 'PASSWORD_INCORRECT', field: 'currentPassword' });

  const ok = await routes.password!(req('/api/users/me/password', { bearer, body: { currentPassword: PASSWORD, newPassword: 'another-password' } }));
  assert.equal(ok.status, 200);
  const { token: fresh } = (await ok.json()) as { token: string };
  assert.equal(stored.tokenVersion, 1);
  assert.equal((await verifySession(fresh, SECRET, SELLER_AUDIENCE)).tv, 1);
  assert.equal(await codeOf(authenticate(req('/x', { bearer }))), 'SESSION_REVOKED', 'the old session ends');
  assert.equal((await authenticate(req('/x', { bearer: fresh }))).tokenVersion, 1, 'this session goes on');
  assert.equal(audits.length, 1);
  stored.passwordHash = await hashPassword(PASSWORD);
});

test('email change: only pendingEmail is stored until the link is used; the old email stays the login', async () => {
  const bearer = await token();
  const response = await routes.email!(req('/api/users/me/email', { bearer, body: { password: PASSWORD, newEmail: 'New@Example.com' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, pendingEmail: 'new@example.com' });
  assert.equal(stored.email, 'ayesha@example.com');
  assert.equal(stored.pendingEmail, 'new@example.com');
  const same = await routes.email!(req('/api/users/me/email', { bearer, body: { password: PASSWORD, newEmail: 'ayesha@example.com' } }));
  assert.equal(((await same.json()) as { field: string }).field, 'newEmail');
});

test('sign out of all other devices: the old token stops, the new one works', async () => {
  const bearer = await token();
  const response = await routes.revoke!(req('/api/users/me/sessions/revoke-others', { bearer }));
  assert.equal(response.status, 200);
  const { token: fresh } = (await response.json()) as { token: string };
  assert.equal(await codeOf(authenticate(req('/x', { bearer }))), 'SESSION_REVOKED');
  assert.equal(await codeOf(authenticate(req('/x', { bearer: fresh }))), 'accepted');
});

// --------------------------------------------------------------------------------------------- login throttle (US05)

const windowKey = (rule: string, subject: string, windowMs: number) =>
  'auth:' + rule + ':' + createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 32) + ':' + Math.floor(Date.now() / windowMs) * windowMs;
const FIFTEEN = 15 * 60 * 1000;
const login = (email: string, password: string) => routes.login!(req('/api/users/login', { body: { email, password } }));

test('unknown email, wrong password and a suspended account get the same login error', async () => {
  const unknown = await login('nobody@example.com', PASSWORD);
  const wrong = await login('ayesha@example.com', 'wrong-password-value');
  stored.accountStatus = 'suspended';
  const suspended = await login('ayesha@example.com', PASSWORD);
  delete stored.accountStatus;
  assert.deepEqual([unknown.status, wrong.status, suspended.status], [401, 401, 401]);
  const texts = await Promise.all([unknown, wrong, suspended].map((r) => r.text()));
  assert.equal(new Set(texts).size, 1, texts.join(' | '));
});

test('10 failures lock the account and 30 lock the address for 15 minutes, with Retry-After', async () => {
  memory.counts.set(windowKey('login-account', 'ayesha@example.com', FIFTEEN), 10);
  const account429 = await login('ayesha@example.com', PASSWORD);
  assert.equal(account429.status, 429);
  assert.ok(Number(account429.headers.get('retry-after')) > 0);
  assert.equal((await login('other@example.com', PASSWORD)).status, 401, 'another account from the same address is not locked yet');

  memory.counts.set(windowKey('login-ip', 'unknown', FIFTEEN), 30);
  assert.equal((await login('other@example.com', PASSWORD)).status, 429);
});

test('a successful login clears the account counter but not the address counter, and carries tokenVersion', async () => {
  await login('ayesha@example.com', 'wrong-password-value');
  await login('ayesha@example.com', 'wrong-password-value');
  assert.equal(memory.counts.get(windowKey('login-account', 'ayesha@example.com', FIFTEEN)), 2);
  stored.tokenVersion = 4;
  const ok = await login('ayesha@example.com', PASSWORD);
  assert.equal(ok.status, 200);
  assert.equal(memory.counts.get(windowKey('login-account', 'ayesha@example.com', FIFTEEN)), undefined);
  assert.equal(memory.counts.get(windowKey('login-ip', 'unknown', FIFTEEN)), 2);
  const body = (await ok.json()) as { token: string };
  assert.equal((await verifySession(body.token, SECRET, SELLER_AUDIENCE)).tv, 4);
});
