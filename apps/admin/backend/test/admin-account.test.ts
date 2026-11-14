import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { AuditLog, hashPassword, signSession, User } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { useMemoryAdminAuthLimits } from '@/lib/admin-account';
import { sellerStatusSteps } from '@/lib/admin-seller-status';
import { createFirstAdmin, type AdminUserModelPort } from '@/lib/create-admin';

// Sprint 4 EP-08 on the admin backend: suspend / unsuspend a seller, the session check, the login throttle and the
// create-admin logic. Models are stubbed and the seller backend call is replaced; no database, no network.

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000003';
const OTHER_ADMIN = '65a000000000000000000004';
const SELLER_ID = '65a000000000000000000001';
const PASSWORD = 'correct-horse-battery-staple';

const UserModel = User as any;
const AuditModel = AuditLog as any;

let users: Record<string, Record<string, any>>;
let audits: Array<Record<string, any>> = [];
let applied: unknown[] = [];
let failApply = false;
let restore: () => void = () => {};
let statusPOST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let loginPOST: (r: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  statusPOST = (await import('../src/app/api/admin/sellers/[id]/status/route')).POST;
  loginPOST = (await import('../src/app/api/admin/session/route')).POST;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value(), exec: async () => value() };
  return q;
};
const statusOf = (doc: Record<string, any>) => doc.accountStatus ?? 'active';

beforeEach(async () => {
  users = {
    [ADMIN_ID]: { _id: ADMIN_ID, role: 'admin', email: 'op@example.com', name: 'Op', passwordHash: await hashPassword(PASSWORD), loginAttempts: 0, lockUntil: null },
    [OTHER_ADMIN]: { _id: OTHER_ADMIN, role: 'admin', email: 'op2@example.com' },
    [SELLER_ID]: { _id: SELLER_ID, role: 'seller', email: 'ayesha@example.com' },
  };
  audits = [];
  applied = [];
  failApply = false;
  const saved = {
    connect: (mongoose as any).connect,
    user: Object.fromEntries(['findById', 'findOne', 'findOneAndUpdate', 'updateOne'].map((m) => [m, UserModel[m]])),
    audit: AuditModel.create,
    apply: sellerStatusSteps.applyInSellerBackend,
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = (id: unknown) => chain(() => (users[String(id)] ? { ...users[String(id)] } : null));
  UserModel.findOne = (filter: any) => chain(() => Object.values(users).find((u) => u.email === filter.email) ?? null);
  UserModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = users[String(filter._id)];
      if (!row || row.role !== filter.role) return null;
      const expected = filter.accountStatus;
      const current = statusOf(row);
      const ok = typeof expected === 'object' ? (current === 'active' && expected.$in.includes('active')) || expected.$in.includes(row.accountStatus) : current === expected;
      if (!ok) return null;
      Object.assign(row, update.$set);
      return { ...row };
    });
  UserModel.updateOne = async (filter: any, update: any) => {
    const row = users[String(filter._id)];
    if (row && (filter.accountStatus === undefined || statusOf(row) === filter.accountStatus)) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0 };
  };
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  sellerStatusSteps.applyInSellerBackend = async (_adminId: string, input: { userId: string; status: 'active' | 'suspended'; reason: string | null }) => {
    if (failApply) throw new Error('seller backend down');
    applied.push(input);
    return { userId: input.userId, status: input.status, changed: true };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.user)) UserModel[m] = fn;
    AuditModel.create = saved.audit;
    sellerStatusSteps.applyInSellerBackend = saved.apply;
  };
});

afterEach(() => restore());

const adminToken = (id = ADMIN_ID, tv?: number) => signSession({ sub: id, role: 'admin', ...(tv === undefined ? {} : { tv }) }, SECRET, ADMIN_AUDIENCE);
const post = async (id: string, body: unknown, bearer?: string) =>
  statusPOST(
    new Request('http://admin.test/api/admin/sellers/' + id + '/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (bearer ?? (await adminToken())) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

test('suspend needs a reason, is applied in the seller backend, and is audited; unsuspend reverses it', async () => {
  const missing = await post(SELLER_ID, { status: 'suspended' });
  assert.equal(missing.status, 400);
  assert.equal(((await missing.json()) as { field: string }).field, 'reason');

  const suspended = await post(SELLER_ID, { status: 'suspended', reason: 'Fake products reported' });
  assert.equal(suspended.status, 200);
  assert.deepEqual(await suspended.json(), { seller: { id: SELLER_ID, accountStatus: 'suspended', changed: true } });
  assert.equal(users[SELLER_ID]!.accountStatus, 'suspended');
  assert.deepEqual(applied, [{ userId: SELLER_ID, status: 'suspended', reason: 'Fake products reported' }]);
  assert.equal(audits[0]!.action, 'seller.suspend');

  const back = await post(SELLER_ID, { status: 'active' });
  assert.equal(back.status, 200);
  assert.equal(users[SELLER_ID]!.accountStatus, 'active');
  assert.equal(audits[1]!.action, 'seller.unsuspend');
});

test('an admin cannot suspend themselves or another admin', async () => {
  const self = await post(ADMIN_ID, { status: 'suspended', reason: 'testing myself' });
  assert.equal(self.status, 403);
  const other = await post(OTHER_ADMIN, { status: 'suspended', reason: 'not allowed here' });
  assert.equal(other.status, 403);
  assert.equal(applied.length, 0);
  assert.equal(users[OTHER_ADMIN]!.accountStatus, undefined);
});

test('when the seller backend cannot apply it, the admin copy is put back and nothing is audited', async () => {
  failApply = true;
  const response = await post(SELLER_ID, { status: 'suspended', reason: 'Fake products reported' });
  assert.equal(response.status, 500);
  assert.equal(statusOf(users[SELLER_ID]!), 'active');
  assert.equal(audits.length, 0);
});

test('a suspended operator, or a token older than the last reset, is refused with the clear code', async () => {
  users[ADMIN_ID]!.accountStatus = 'suspended';
  const suspended = await post(SELLER_ID, { status: 'active' });
  assert.equal(suspended.status, 401);
  assert.equal(((await suspended.json()) as { code: string }).code, 'ACCOUNT_SUSPENDED');

  users[ADMIN_ID]!.accountStatus = 'active';
  users[ADMIN_ID]!.tokenVersion = 2;
  const old = await post(SELLER_ID, { status: 'active' }, await adminToken(ADMIN_ID, 1));
  assert.equal(((await old.json()) as { code: string }).code, 'SESSION_REVOKED');
  const current = await post(SELLER_ID, { status: 'active' }, await adminToken(ADMIN_ID, 2));
  assert.equal(current.status, 200);
});

// ---------------------------------------------------------------------------------------------- login throttle

const FIFTEEN = 15 * 60 * 1000;
const windowKey = (rule: string, subject: string) =>
  'auth:' + rule + ':' + createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 32) + ':' + Math.floor(Date.now() / FIFTEEN) * FIFTEEN;
const login = (email: string, password: string) =>
  loginPOST(new Request('http://admin.test/api/admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }));

test('admin login: 429 past the account or address limit; a success clears only the account counter', async () => {
  const memory = useMemoryAdminAuthLimits();
  assert.equal((await login('op@example.com', 'wrong-password')).status, 401);
  const ok = await login('op@example.com', PASSWORD);
  assert.equal(ok.status, 200);
  assert.equal(memory.counts.get(windowKey('login-account', 'op@example.com')), undefined);
  assert.equal(memory.counts.get(windowKey('login-ip', 'unknown')), 1);

  memory.counts.set(windowKey('login-account', 'op@example.com'), 10);
  const limited = await login('op@example.com', PASSWORD);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('a suspended operator gets the same login error as a wrong password', async () => {
  useMemoryAdminAuthLimits();
  const wrong = await login('op@example.com', 'wrong-password');
  users[ADMIN_ID]!.accountStatus = 'suspended';
  const suspended = await login('op@example.com', PASSWORD);
  assert.equal(wrong.status, 401);
  assert.equal(suspended.status, 401);
  assert.equal(await wrong.text(), await suspended.text());
});

// ------------------------------------------------------------------------------------------------- create-admin

function fakeAdminUsers(existingAdmin: boolean) {
  const created: Array<Record<string, unknown>> = [];
  const model: AdminUserModelPort = {
    exists: async (filter) => (filter.role === 'admin' && (existingAdmin || created.length > 0) ? { _id: 'x' } : null),
    findOne: () => ({ select: () => ({ lean: async () => null }) }),
    create: async (doc) => {
      created.push(doc);
      return { _id: '65a0000000000000000000ff', ...doc };
    },
  };
  return { model, created };
}

const deps = { hashPassword: async (p: string) => 'hashed(' + p.length + ')', passwordProblem: (v: unknown) => (typeof v === 'string' && v.length >= 8 ? null : 'password must be at least 8 characters') };

test('create-admin makes the first admin, refuses a second run without --force, and never returns the password', async () => {
  const fake = fakeAdminUsers(false);
  const first = await createFirstAdmin(fake.model, { email: 'Op@Example.com', password: 'a-strong-password' }, deps);
  assert.deepEqual(first, { ok: true, id: '65a0000000000000000000ff', email: 'op@example.com' });
  assert.equal(JSON.stringify(first).includes('a-strong-password'), false);
  assert.equal(fake.created[0]!.role, 'admin');
  assert.equal(fake.created[0]!.passwordHash, 'hashed(17)');

  const second = await createFirstAdmin(fake.model, { email: 'two@example.com', password: 'a-strong-password' }, deps);
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.reason, 'ADMIN_EXISTS');
  assert.equal(JSON.stringify(second).includes('a-strong-password'), false);

  const forced = await createFirstAdmin(fake.model, { email: 'two@example.com', password: 'a-strong-password', force: true }, deps);
  assert.equal(forced.ok, true);
});

test('create-admin refuses a weak password and a bad email before touching the database', async () => {
  const fake = fakeAdminUsers(false);
  const weak = await createFirstAdmin(fake.model, { email: 'op@example.com', password: 'short' }, deps);
  assert.equal(!weak.ok && weak.reason, 'INVALID_PASSWORD');
  const bad = await createFirstAdmin(fake.model, { email: 'not-an-email', password: 'a-strong-password' }, deps);
  assert.equal(!bad.ok && bad.reason, 'INVALID_EMAIL');
  assert.equal(fake.created.length, 0);
});
