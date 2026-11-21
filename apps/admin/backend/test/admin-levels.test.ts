import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { ADMIN_CAPABILITIES } from '../../../../packages/auth/src/admin-levels';
import { AuditLog, AuthToken, NotificationOutbox, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { adminUserSteps, changeAdminLevel, inviteAdminUser, listAdminUsers, setAdminStatus, acceptAdminInvite } from '../src/lib/admin-users';
import { AUDIT_EXPORT_ROW_CAP, auditCsvCell, auditExportSteps, exportFilter, parseExportQuery, toAuditCsv } from '../src/lib/admin-audit-export';
import { planAdminLevels, MISSING_LEVEL_FILTER } from '../../../../scripts/lib/admin-level-migration.mjs';

// Sprint 6 (S6-B6, D-118): admin levels, the capability on every admin route, admin users and the audit export. Models are stubbed in memory.

const SECRET = 'x'.repeat(40);
const OWNER = '65a000000000000000000001';
const OWNER2 = '65a000000000000000000002';
const FINANCE = '65a000000000000000000003';
const UserModel = User as any;
const AuditModel = AuditLog as any;
const TokenModel = AuthToken as any;
const OutboxModel = NotificationOutbox as any;

let users: Array<Record<string, any>>;
let audits: any[];
let tokens: any[];
let outbox: any[];
let restore: () => void = () => {};

const matches = (row: any, filter: any): boolean =>
  Object.entries(filter).every(([k, v]: [string, any]) => {
    if (k === '$or') return v.some((f: any) => matches(row, f));
    if (v && typeof v === 'object' && '$ne' in v) return String(row[k]) !== String(v.$ne);
    if (v && typeof v === 'object' && '$in' in v) return v.$in.some((x: any) => (x === null ? row[k] == null : row[k] === x));
    if (v === null) return row[k] == null;
    return String(row[k]) === String(v);
  });
const chain = (value: () => any) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  users = [
    { _id: OWNER, name: 'Olive', email: 'o@x.test', role: 'admin', adminLevel: 'owner', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date(), createdAt: new Date('2026-01-01') },
    { _id: FINANCE, name: 'Fin', email: 'f@x.test', role: 'admin', adminLevel: 'finance', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date(), createdAt: new Date('2026-02-01') },
  ];
  audits = [];
  tokens = [];
  outbox = [];
  const saved = {
    connect: (mongoose as any).connect,
    find: UserModel.find, findById: UserModel.findById, findOne: UserModel.findOne, count: UserModel.countDocuments, update: UserModel.findOneAndUpdate, create: UserModel.create,
    tcreate: TokenModel.create, tmany: TokenModel.updateMany, tupdate: TokenModel.findOneAndUpdate,
    ocreate: OutboxModel.create, ofind: OutboxModel.findOne, oupdate: OutboxModel.findOneAndUpdate,
    steps: adminUserSteps.audit, exp: auditExportSteps.audit, afind: AuditModel.find, acount: AuditModel.countDocuments,
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.find = (f: any) => chain(() => users.filter((u) => matches(u, f)).map((u) => ({ ...u })));
  UserModel.findById = (id: string) => chain(() => { const u = users.find((x) => x._id === id); return u ? { ...u } : null; });
  UserModel.findOne = (f: any) => chain(() => { const u = users.find((x) => matches(x, f)); return u ? { ...u } : null; });
  UserModel.countDocuments = async (f: any) => users.filter((u) => matches(u, f)).length;
  UserModel.findOneAndUpdate = (f: any, change: any) => chain(() => {
    const u = users.find((x) => matches(x, f));
    if (!u) return null;
    Object.assign(u, change.$set ?? {});
    if (change.$inc?.tokenVersion) u.tokenVersion += change.$inc.tokenVersion;
    return { ...u };
  });
  UserModel.create = async (doc: any) => { const u = { _id: '65a0000000000000000000a' + (users.length % 10), createdAt: new Date(), ...doc }; users.push(u); return { ...u }; };
  TokenModel.updateMany = async () => undefined;
  TokenModel.create = async (doc: any) => { tokens.push({ ...doc }); };
  TokenModel.findOneAndUpdate = (f: any) => chain(() => { const t = tokens.find((x) => x.tokenHash === f.tokenHash && x.usedAt === null && x.expiresAt > f.expiresAt.$gt); if (!t) return null; t.usedAt = new Date(); return { ...t }; });
  OutboxModel.create = async (doc: any) => { outbox.push(doc); return { _id: 'o1', ...doc }; };
  OutboxModel.findOne = () => chain(() => null);
  OutboxModel.findOneAndUpdate = () => chain(() => null);
  adminUserSteps.audit = (async (...a: any[]) => audits.push(a)) as any;
  auditExportSteps.audit = (async (...a: any[]) => audits.push(a)) as any;
  restore = () => {
    (mongoose as any).connect = saved.connect;
    Object.assign(UserModel, { find: saved.find, findById: saved.findById, findOne: saved.findOne, countDocuments: saved.count, findOneAndUpdate: saved.update, create: saved.create });
    Object.assign(TokenModel, { create: saved.tcreate, updateMany: saved.tmany, findOneAndUpdate: saved.tupdate });
    Object.assign(OutboxModel, { create: saved.ocreate, findOne: saved.ofind, findOneAndUpdate: saved.oupdate });
    adminUserSteps.audit = saved.steps;
    auditExportSteps.audit = saved.exp;
    AuditModel.find = saved.afind;
    AuditModel.countDocuments = saved.acount;
  };
});
afterEach(() => restore());

const token = (sub: string) => signSession({ sub, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
const get = async (url: string, sub: string) => new Request('http://admin.test' + url, { headers: { authorization: 'Bearer ' + (await token(sub)) } });
const post = async (url: string, sub: string, body: unknown = {}) =>
  new Request('http://admin.test' + url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await token(sub)) }, body: JSON.stringify(body) });

// ------------------------------------------------------------------------------------------------------------------ the guard

const ROUTES_DIR = path.join(process.cwd(), 'src', 'app', 'api', 'admin');
function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routeFiles(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : []));
}
/** The few admin routes that legitimately do not use authorizeAdmin with a capability. Anything else must declare one. */
const EXCEPTIONS: Record<string, string> = {
  'session/route.ts': 'login and logout: no session yet',
  'password/forgot/route.ts': 'forgot password: no session',
  'password/reset/route.ts': 'reset password: the token is the credential',
  'invite/accept/route.ts': 'accept invite: the token is the credential',
  'me/route.ts': 'the console session check: any signed-in admin (ANY_ADMIN)',
};

test('GUARD: every admin route file declares a capability on every authorizeAdmin call; the exceptions are listed here and nowhere else', () => {
  const files = routeFiles(ROUTES_DIR);
  assert.ok(files.length > 30, 'the guard found the routes');
  const seen = new Set<string>();
  for (const file of files) {
    const rel = path.relative(ROUTES_DIR, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    const calls = [...source.matchAll(/authorizeAdmin\(\s*request\s*(?:,\s*([^)]*))?\)/g)];
    if (rel in EXCEPTIONS) {
      seen.add(rel);
      if (rel === 'me/route.ts') assert.ok(/authorizeAdmin\(request, ANY_ADMIN\)/.test(source), rel);
      else assert.equal(calls.length, 0, rel + ' is an exception: it has no session gate');
      continue;
    }
    assert.ok(calls.length > 0, rel + ' has no authorizeAdmin call: add a capability or list it as an exception with a reason');
    for (const call of calls) {
      const literal = /^'([a-z_]+\.[a-z_]+)'$/.exec((call[1] ?? '').trim());
      assert.ok(literal, rel + ': authorizeAdmin must be given a capability literal, got ' + JSON.stringify(call[1]));
      assert.ok((ADMIN_CAPABILITIES as readonly string[]).includes(literal![1]!), rel + ': unknown capability ' + literal![1]);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(EXCEPTIONS).sort(), 'every listed exception still exists');
});

test('GUARD: authorizeAdmin cannot be called without a capability (the parameter is required)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'admin-session.ts'), 'utf8');
  assert.match(source, /authorizeAdmin\(request: Request, capability: AdminCapability \| typeof ANY_ADMIN\)/);
});

// ------------------------------------------------------------------------------------------------------- levels against routes

type Handler = (request: Request, context?: any) => Promise<Response>;
async function routeOf(rel: string, method: 'GET' | 'POST'): Promise<Handler> {
  return ((await import('../src/app/api/admin/' + rel + '/route')) as any)[method];
}

const SAMPLE: Array<{ name: string; rel: string; method: 'GET' | 'POST'; url: string; allowed: string[] }> = [
  { name: 'orders list', rel: 'orders', method: 'GET', url: '/api/admin/orders', allowed: ['owner', 'customer_support'] },
  { name: 'payments list', rel: 'subscription-payments', method: 'GET', url: '/api/admin/subscription-payments', allowed: ['owner', 'finance'] },
  { name: 'sellers list', rel: 'sellers', method: 'GET', url: '/api/admin/sellers', allowed: ['owner', 'operations', 'customer_support'] },
  { name: 'stores list', rel: 'stores', method: 'GET', url: '/api/admin/stores', allowed: ['owner', 'operations'] },
  { name: 'payouts balances', rel: 'payouts/balances', method: 'GET', url: '/api/admin/payouts/balances', allowed: ['owner', 'finance'] },
  { name: 'sync outbox', rel: 'sync/outbox', method: 'GET', url: '/api/admin/sync/outbox', allowed: ['owner', 'operations'] },
  { name: 'settings read', rel: 'settings', method: 'GET', url: '/api/admin/settings', allowed: ['owner', 'operations'] },
  { name: 'audit list', rel: 'audit', method: 'GET', url: '/api/admin/audit', allowed: ['owner'] },
  { name: 'audit export', rel: 'audit/export', method: 'GET', url: '/api/admin/audit/export', allowed: ['owner'] },
  { name: 'users list', rel: 'users', method: 'GET', url: '/api/admin/users', allowed: ['owner'] },
  { name: 'plans read', rel: 'subscription-plans', method: 'GET', url: '/api/admin/subscription-plans', allowed: ['owner', 'finance', 'operations'] },
  { name: 'commission rates', rel: 'commission/rates', method: 'GET', url: '/api/admin/commission/rates', allowed: ['owner', 'finance'] },
  { name: 'overview', rel: 'overview', method: 'GET', url: '/api/admin/overview', allowed: ['owner', 'finance', 'operations'] },
];

test('LEVELS: every level against a sample of routes: 403 where the level lacks the capability, and past the gate (not 401/403) where it has it', async () => {
  for (const level of ['owner', 'finance', 'operations', 'customer_support'] as const) {
    users[0]!.adminLevel = level;
    for (const sample of SAMPLE) {
      const handler = await routeOf(sample.rel, sample.method);
      const res = await handler(await get(sample.url, OWNER));
      if (sample.allowed.includes(level)) assert.equal([401, 403].includes(res.status), false, level + ' on ' + sample.name + ' got ' + res.status);
      else {
        assert.equal(res.status, 403, level + ' on ' + sample.name);
        assert.equal(((await res.json()) as { code?: string }).code, 'CAPABILITY_REQUIRED');
      }
    }
  }
});

test('LEVELS: the void of a subscription payment is owner only; finance can decide but not void; support can do neither', async () => {
  const confirm = (await import('../src/app/api/admin/subscription-payments/[id]/confirm/route')).POST;
  const voidPost = (await import('../src/app/api/admin/subscription-payments/[id]/void/route')).POST;
  const ctx = { params: Promise.resolve({ id: '65a0000000000000000e0001' }) };
  const cases: Array<[string, number | 'pass', number | 'pass']> = [['owner', 'pass', 'pass'], ['finance', 'pass', 403], ['operations', 403, 403], ['customer_support', 403, 403]];
  for (const [level, confirmExpect, voidExpect] of cases) {
    users[0]!.adminLevel = level;
    const c = await confirm(await post('/x', OWNER, {}), ctx);
    const v = await voidPost(await post('/x', OWNER, {}), ctx);
    if (confirmExpect === 403) assert.equal(c.status, 403, level + ' confirm'); else assert.notEqual(c.status, 403, level + ' confirm');
    if (voidExpect === 403) assert.equal(v.status, 403, level + ' void'); else assert.notEqual(v.status, 403, level + ' void');
  }
});

test('LEVELS: an admin with no level is an owner; a level change takes effect on the very next request; a disabled admin is refused on the next request', async () => {
  const ordersGET = (await import('../src/app/api/admin/orders/route')).GET;
  delete users[0]!.adminLevel;
  assert.notEqual((await (await import('../src/app/api/admin/users/route')).GET(await get('/u', OWNER))).status, 403, 'no level = owner');
  users[0]!.adminLevel = 'finance';
  assert.equal((await ordersGET(await get('/o', OWNER))).status, 403);
  users[0]!.adminLevel = 'customer_support';
  assert.notEqual((await ordersGET(await get('/o', OWNER))).status, 403, 'the new level applies at once: the account is read on every request (no cache)');
  users[0]!.accountStatus = 'suspended';
  assert.equal((await ordersGET(await get('/o', OWNER))).status, 401, 'a disabled admin is refused on the next request');
});

test('me carries the level and the capability list for the console', async () => {
  const me = (await import('../src/app/api/admin/me/route')).GET;
  users[1]!.adminLevel = 'customer_support';
  const res = await me(await get('/me', FINANCE));
  const body = (await res.json()) as any;
  assert.equal(body.adminLevel, 'customer_support');
  assert.deepEqual(body.capabilities, ['orders.read', 'sellers.read', 'tickets.read', 'tickets.reply', 'contact.read']);
});

// -------------------------------------------------------------------------------------------------------------------- users

test('users routes are owner only', async () => {
  const list = (await import('../src/app/api/admin/users/route')).GET;
  const invite = (await import('../src/app/api/admin/users/route')).POST;
  const level = (await import('../src/app/api/admin/users/[id]/level/route')).POST;
  const disable = (await import('../src/app/api/admin/users/[id]/disable/route')).POST;
  const ctx = { params: Promise.resolve({ id: FINANCE }) };
  for (const l of ['finance', 'operations', 'customer_support']) {
    users[0]!.adminLevel = l;
    assert.equal((await list(await get('/u', OWNER))).status, 403, l);
    assert.equal((await invite(await post('/u', OWNER, { name: 'N', email: 'n@x.test', adminLevel: 'finance' }))).status, 403, l);
    assert.equal((await level(await post('/u', OWNER, { adminLevel: 'owner', reason: 'because' }), ctx)).status, 403, l);
    assert.equal((await disable(await post('/u', OWNER, { reason: 'because' }), ctx)).status, 403, l);
  }
  assert.equal(users[1]!.adminLevel, 'finance');
});

test('the list shows admins with their level (a missing level reads as owner) and no secrets', async () => {
  delete users[1]!.adminLevel;
  const { users: list } = await listAdminUsers();
  assert.deepEqual(list.map((u) => [u.email, u.adminLevel, u.accepted]), [['o@x.test', 'owner', true], ['f@x.test', 'owner', true]]);
  assert.equal(JSON.stringify(list).includes('passwordHash'), false);
});

test('a level change is audited with who, the target, from, to and the reason; an admin cannot change their own level', async () => {
  const out = await changeAdminLevel(OWNER, FINANCE, { adminLevel: 'operations', reason: 'Moved to operations' });
  assert.deepEqual([out.changed, out.user.adminLevel, users[1]!.adminLevel], [true, 'operations', 'operations']);
  const [action, entity, id, actor, details] = audits[0];
  assert.deepEqual([action, entity, id, actor], ['admin_user.level_changed', 'user', FINANCE, OWNER]);
  assert.deepEqual([details.from, details.to, details.reason], ['finance', 'operations', 'Moved to operations']);
  await assert.rejects(() => changeAdminLevel(OWNER, OWNER, { adminLevel: 'finance', reason: 'myself' }), (e: any) => e.status === 403 && e.code === 'SELF_CHANGE');
  assert.equal((await changeAdminLevel(OWNER, FINANCE, { adminLevel: 'operations', reason: 'again' })).changed, false);
});

test('the LAST active owner can be neither demoted nor disabled; with a second owner both work; a disabled owner does not count', async () => {
  users.push({ _id: OWNER2, name: 'Two', email: 't@x.test', role: 'admin', adminLevel: 'owner', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date(), createdAt: new Date() });
  users[1]!.adminLevel = 'finance';
  // two owners: demoting one is fine
  assert.equal((await changeAdminLevel(OWNER, OWNER2, { adminLevel: 'finance', reason: 'Step down' })).changed, true);
  // now OWNER is the last owner: the other admins cannot demote or disable them
  await assert.rejects(() => changeAdminLevel(OWNER2, OWNER, { adminLevel: 'finance', reason: 'No way' }), (e: any) => e.status === 409 && e.code === 'LAST_OWNER');
  await assert.rejects(() => setAdminStatus(OWNER2, OWNER, 'suspended', { reason: 'No way' }), (e: any) => e.status === 409 && e.code === 'LAST_OWNER');
  assert.deepEqual([users[0]!.adminLevel, users[0]!.accountStatus], ['owner', 'active']);
  // a disabled owner is not an active owner
  users.push({ _id: '65a0000000000000000000b1', name: 'Gone', email: 'g@x.test', role: 'admin', adminLevel: 'owner', accountStatus: 'suspended', tokenVersion: 0, emailVerifiedAt: new Date(), createdAt: new Date() });
  await assert.rejects(() => setAdminStatus(OWNER2, OWNER, 'suspended', { reason: 'Still last' }), (e: any) => e.code === 'LAST_OWNER');
});

test('disable and enable: audited, end the sessions (tokenVersion), refuse self, and are idempotent', async () => {
  const off = await setAdminStatus(OWNER, FINANCE, 'suspended', { reason: 'Left the company' });
  assert.deepEqual([off.changed, users[1]!.accountStatus, users[1]!.tokenVersion], [true, 'suspended', 1]);
  assert.equal(audits[0][0], 'admin_user.disabled');
  assert.equal((await setAdminStatus(OWNER, FINANCE, 'suspended', { reason: 'Left the company' })).changed, false);
  const on = await setAdminStatus(OWNER, FINANCE, 'active', { reason: 'Came back' });
  assert.deepEqual([on.changed, users[1]!.accountStatus], [true, 'active']);
  assert.equal(audits[1][0], 'admin_user.enabled');
  await assert.rejects(() => setAdminStatus(OWNER, OWNER, 'suspended', { reason: 'myself' }), (e: any) => e.status === 403 && e.code === 'SELF_CHANGE');
  await assert.rejects(() => setAdminStatus(OWNER, '65a0000000000000000000ee', 'suspended', { reason: 'unknown' }), (e: any) => e.status === 404);
});

test('invite: a new admin with the chosen level, a 7 day single-use hashed token, an email through the outbox; accept sets the password once', async () => {
  process.env.APP_BASE_URL_ADMIN = 'https://admin.markazify.test';
  const out = await inviteAdminUser(OWNER, { name: 'Newcomer', email: 'new@x.test', adminLevel: 'customer_support' });
  assert.deepEqual([out.user.adminLevel, out.user.accepted, out.user.email], ['customer_support', false, 'new@x.test']);
  assert.equal(tokens.length, 1);
  const stored = tokens[0];
  assert.equal(stored.kind, 'admin_invite');
  assert.match(stored.tokenHash, /^[0-9a-f]{64}$/, 'only the hash is stored');
  assert.equal(Math.round((stored.expiresAt.getTime() - Date.now()) / 86_400_000), 7);
  const row = outbox.find((o) => o.template === 'admin_invite');
  assert.equal(row.to, 'new@x.test');
  const raw = /token=([A-Za-z0-9_-]{43})/.exec(row.bodyText)![1]!;
  assert.equal(JSON.stringify(stored).includes(raw), false);
  assert.equal(audits[0][0], 'admin_user.invited');
  await assert.rejects(() => acceptAdminInvite(raw, 'short'), (e: any) => e.status === 400 && e.field === 'password');
  assert.deepEqual(await acceptAdminInvite(raw, 'a-very-strong-passphrase-123'), { ok: true });
  const created = users.find((u) => u.email === 'new@x.test')!;
  assert.notEqual(created.emailVerifiedAt, null);
  await assert.rejects(() => acceptAdminInvite(raw, 'a-very-strong-passphrase-123'), (e: any) => e.code === 'TOKEN_INVALID');
  await assert.rejects(() => acceptAdminInvite('A'.repeat(43), 'a-very-strong-passphrase-123'), (e: any) => e.code === 'TOKEN_INVALID');
  await assert.rejects(() => inviteAdminUser(OWNER, { name: 'Dup', email: 'o@x.test', adminLevel: 'finance' }), (e: any) => e.status === 409 && e.code === 'EMAIL_TAKEN');
});

test('the migration plan makes every admin without a level an owner, explicitly; a second run finds nothing', () => {
  const plan = planAdminLevels([{ _id: 'a', role: 'admin' }, { _id: 'b', role: 'admin', adminLevel: 'finance' }, { _id: 'c', role: 'seller' }, { _id: 'd', role: 'admin', adminLevel: '' }]);
  assert.deepEqual(plan, { toOwner: ['a', 'd'], alreadySet: 1 });
  assert.deepEqual(MISSING_LEVEL_FILTER.role, 'admin');
  assert.deepEqual(planAdminLevels([{ _id: 'a', role: 'admin', adminLevel: 'owner' }]), { toOwner: [], alreadySet: 1 });
  const script = fs.readFileSync(path.join(process.cwd(), '..', '..', '..', 'scripts', 'migrate-admin-levels.mjs'), 'utf8');
  assert.match(script, /throwaway/);
  assert.match(script, /dry run/);
});

// ---------------------------------------------------------------------------------------------------------------- audit export

test('CSV cells: a formula start is guarded with an apostrophe, a plain E.164 phone is not, quotes are doubled, null is empty', () => {
  assert.equal(auditCsvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  for (const bad of ['+cmd', '-1+2', '@evil', '\tx', '\rx']) assert.equal(auditCsvCell(bad).startsWith('"\''), true, JSON.stringify(bad));
  assert.equal(auditCsvCell('+923001234567'), '"+923001234567"');
  assert.equal(auditCsvCell('+92 300 123'), '"\'+92 300 123"', 'only a plain E.164 number is exempt');
  assert.equal(auditCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(auditCsvCell(null), '""');
});

test('the CSV has the BOM, one header and one row per entry', () => {
  const csv = toAuditCsv([{ id: '1', action: 'store.suspend', entity: 'store', entityId: 's1', actor: { id: 'a1', name: '=Evil' }, reason: 'spam', note: null, from: 'active', to: 'suspended', createdAt: '2026-11-20T10:00:00.000Z' }] as any);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1]!.includes('"\'=Evil"'));
});

test('the export filters: action, search, and a date range with the end day inclusive; bad input is a 400 naming the field', () => {
  const q = parseExportQuery(new URLSearchParams('action=store.suspend&from=2026-11-01&to=2026-11-30'));
  const f = exportFilter(q) as any;
  assert.equal(f.$and[1].createdAt.$gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(f.$and[1].createdAt.$lt.toISOString(), '2026-12-01T00:00:00.000Z');
  for (const [query, field] of [['from=yesterday', 'from'], ['to=2026-13-45', 'to'], ['action=%24where', 'action'], ['from=2026-12-01&to=2026-11-01', 'from']] as const) {
    assert.throws(() => parseExportQuery(new URLSearchParams(query)), (e: any) => e.status === 400 && e.field === field, query);
  }
});

test('the export route: owner only, capped at 5000 rows, CSV headers, the export itself is audited first and fails closed', async () => {
  const exportGET = (await import('../src/app/api/admin/audit/export/route')).GET;
  const rows = Array.from({ length: 3 }, (_, i) => ({ _id: 'r' + i, action: 'store.suspend', entity: 'store', entityId: 's' + i, actorId: OWNER, details: { reason: '=cmd' }, createdAt: new Date('2026-11-20T10:00:00Z') }));
  let limit = 0;
  AuditModel.find = () => { const q: any = { sort: () => q, limit: (n: number) => ((limit = n), q), lean: async () => rows }; return q; };
  AuditModel.countDocuments = async () => 6000;
  users[1]!.adminLevel = 'finance';
  assert.equal((await exportGET(await get('/e', FINANCE))).status, 403);
  assert.equal(audits.length, 0);
  const res = await exportGET(await get('/e?action=store.suspend', OWNER));
  assert.equal(res.status, 200);
  assert.equal(limit, AUDIT_EXPORT_ROW_CAP);
  assert.equal(AUDIT_EXPORT_ROW_CAP, 5000);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(res.headers.get('x-export-truncated'), 'true');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM (Response.text() would strip it, so the bytes are read)');
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  assert.ok(text.includes("\"'=cmd\""), 'the reason is guarded');
  assert.deepEqual([audits[0][0], audits[0][3], audits[0][4].rows], ['audit.exported', OWNER, 3]);
  auditExportSteps.audit = (async () => { throw new Error('down'); }) as any;
  assert.equal((await exportGET(await get('/e', OWNER))).status, 503, 'no audit entry, no file');
});

test('S6-B7: an admin whose stored level is garbage (not missing) is refused with 403 everywhere, the session check included', async () => {
  const meGET = (await import('../src/app/api/admin/me/route')).GET;
  const ordersGET = (await import('../src/app/api/admin/orders/route')).GET;
  for (const garbage of ['superuser', 'Owner', '', 'admin']) {
    users[0]!.adminLevel = garbage;
    assert.equal((await ordersGET(await get('/o', OWNER))).status, 403, JSON.stringify(garbage));
    assert.equal((await meGET(await get('/me', OWNER))).status, 403, JSON.stringify(garbage));
  }
  users[0]!.adminLevel = null;
  assert.notEqual((await ordersGET(await get('/o', OWNER))).status, 403, 'null is a missing level: owner');
});
