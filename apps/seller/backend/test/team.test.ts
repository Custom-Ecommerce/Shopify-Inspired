import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, NotificationOutbox, signSession, Store, StoreMember, User } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setMembershipListLoader, setMembershipLoader } from '../src/lib/data-plane';
import { setPlanLoader } from '../src/lib/plan';
import { setSessionUserLoader } from '../src/lib/session-user';

// Sprint 8 (S8-B2, D-118): a store's team: the invite flow, the owner-only team routes, membership checked on every request, the roles of the settings groups
// (tax: owner and manager), the workspace list with roles. Models are in memory; no database; email goes to the stubbed outbox.

const SECRET = 'x'.repeat(40);
const OWNER = '65a000000000000000000001';
const OWNER_B = '65a000000000000000000002';
const MANAGER = '65a000000000000000000003';
const STAFF = '65a000000000000000000004';
const SUPPORT = '65a000000000000000000005';
const STRANGER = '65a000000000000000000006';
const INVITEE = '65a000000000000000000007';
const ADMIN = '65a000000000000000000009';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const T0 = new Date('2026-11-14T10:00:00Z');

const StoreModel = Store as any;
const MemberModel = StoreMember as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;
const OutboxModel = NotificationOutbox as any;

type Row = Record<string, any>;
let stores: Record<string, Row>;
let users: Record<string, Row>;
let members: Row[];
let audits: Row[];
let outbox: Row[];
let seatLimit: number | null;
let tokens: Record<string, string> = {};
let restore: () => void = () => {};
let seq = 0;

type Handler = (r: NextRequest, c: any) => Promise<Response>;
let teamGET: Handler;
let inviteRoute: Handler;
let memberPATCH: Handler;
let resendPOST: Handler;
let disablePOST: Handler;
let enablePOST: Handler;
let removePOST: Handler;
let acceptPOST: Handler;
let infoGET: Handler;
let settingsPATCH: Handler;
let settingsGET: Handler;
let workspaceGET: Handler;
let meGET: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  for (const [name, id, role] of [['owner', OWNER, 'seller'], ['ownerB', OWNER_B, 'seller'], ['manager', MANAGER, 'seller'], ['staff', STAFF, 'seller'], ['support', SUPPORT, 'seller'], ['stranger', STRANGER, 'seller'], ['invitee', INVITEE, 'seller'], ['admin', ADMIN, 'admin']] as const) {
    tokens[name] = await signSession({ sub: id, role }, SECRET, SELLER_AUDIENCE);
  }
  teamGET = (await import('../src/app/api/stores/[id]/team/route')).GET as Handler;
  inviteRoute = (await import('../src/app/api/stores/[id]/team/invite/route')).POST as Handler;
  memberPATCH = (await import('../src/app/api/stores/[id]/team/[memberId]/route')).PATCH as Handler;
  resendPOST = (await import('../src/app/api/stores/[id]/team/[memberId]/resend/route')).POST as Handler;
  disablePOST = (await import('../src/app/api/stores/[id]/team/[memberId]/disable/route')).POST as Handler;
  enablePOST = (await import('../src/app/api/stores/[id]/team/[memberId]/enable/route')).POST as Handler;
  removePOST = (await import('../src/app/api/stores/[id]/team/[memberId]/remove/route')).POST as Handler;
  acceptPOST = (await import('../src/app/api/team/accept/route')).POST as Handler;
  infoGET = (await import('../src/app/api/team/invite/route')).GET as Handler;
  settingsPATCH = (await import('../src/app/api/stores/[id]/route')).PATCH as Handler;
  settingsGET = (await import('../src/app/api/stores/[id]/settings/route')).GET as Handler;
  workspaceGET = (await import('../src/app/api/workspace/route')).GET as Handler;
  meGET = (await import('../src/app/api/users/me/route')).GET as Handler;
});

// ------------------------------------------------------------------------------------------------------------ the in-memory world

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value() };
  return q;
};
const clone = <T>(value: T): T => structuredClone(value);
/** ObjectIds become their hex text, as the stubs compare ids as text. */
const flat = (doc: Row): Row => Object.fromEntries(Object.entries(doc).map(([key, value]) => [key, value instanceof mongoose.Types.ObjectId ? String(value) : value]));
const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, wanted]: [string, any]) => {
    if (wanted && typeof wanted === 'object' && !(wanted instanceof Date) && !(wanted instanceof mongoose.Types.ObjectId)) {
      if ('$in' in wanted) return wanted.$in.map(String).includes(String(row[key]));
      if ('$gt' in wanted) return row[key] instanceof Date && row[key].getTime() > wanted.$gt.getTime();
      if ('$ne' in wanted) return String(row[key]) !== String(wanted.$ne);
    }
    return String(row[key]) === String(wanted);
  });
}

beforeEach(() => {
  seq = 0;
  stores = {
    [STORE_A]: { _id: STORE_A, owner: OWNER, slug: 'zara', name: 'Zara Lawn', status: 'active', storefront: { deliveryRate: 250 }, paymentSettings: {}, updatedAt: T0 },
    [STORE_B]: { _id: STORE_B, owner: OWNER_B, slug: 'bilal', name: 'Bilal Shoes', status: 'active', storefront: {}, paymentSettings: {}, updatedAt: T0 },
  };
  users = {
    [OWNER]: { _id: OWNER, email: 'owner@zara.pk', name: 'Ayesha Khan' },
    [OWNER_B]: { _id: OWNER_B, email: 'owner@bilal.pk', name: 'Bilal' },
    [MANAGER]: { _id: MANAGER, email: 'manager@zara.pk', name: 'Mona' },
    [STAFF]: { _id: STAFF, email: 'staff@zara.pk', name: 'Sami' },
    [SUPPORT]: { _id: SUPPORT, email: 'support@zara.pk', name: 'Sana' },
    [STRANGER]: { _id: STRANGER, email: 'stranger@x.pk', name: 'Nobody' },
    [INVITEE]: { _id: INVITEE, email: 'new@zara.pk', name: 'Newcomer' },
  };
  members = [];
  audits = [];
  outbox = [];
  seatLimit = 3;
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  delete process.env.EMAIL_PROVIDER;
  delete process.env.STOREFRONT_URL;
  delete process.env.REVALIDATE_SECRET;

  const savedReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const saved = {
    connect: (mongoose as any).connect,
    store: Object.fromEntries(['findById', 'findOne', 'findOneAndUpdate', 'exists', 'find'].map((m) => [m, StoreModel[m]])),
    member: Object.fromEntries(['find', 'findOne', 'create', 'findOneAndUpdate', 'findOneAndDelete', 'countDocuments'].map((m) => [m, MemberModel[m]])),
    user: Object.fromEntries(['findById', 'find'].map((m) => [m, UserModel[m]])),
    audit: AuditModel.create,
    outbox: Object.fromEntries(['create', 'findOne', 'findOneAndUpdate'].map((m) => [m, OutboxModel[m]])),
  };
  (mongoose as any).connect = async () => mongoose;
  // An open connection: the outbox and the plan checks run. Every model the routes touch is stubbed below.
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  setSessionUserLoader(async (id: string) => ({ role: id === ADMIN ? 'admin' : 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: T0 }) as never);
  setPlanLoader(async () => ({ key: 'growth', name: 'Growth', status: 'active', limits: { stores: 3, products: null, staffSeats: seatLimit, apiKeys: 1, customDomain: true, premiumThemes: true } }) as never);
  // The member row is read from the live array on every request (never cached): the seam of data-plane.ts.
  setMembershipLoader(async (storeId, userId) => members.find((m) => String(m.store) === storeId && String(m.user) === userId && m.status === 'active') ?? null);
  setMembershipListLoader(async (userId) => members.filter((m) => String(m.user) === userId && m.status === 'active').map((m) => ({ store: m.store, role: m.role })));

  StoreModel.findById = (id: unknown) => chain(() => (stores[String(id)] ? clone(stores[String(id)]) : null));
  StoreModel.exists = async (filter: any) => (stores[String(filter._id)] && String(stores[String(filter._id)]!.owner) === String(filter.owner) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) =>
    chain(() => {
      if (filter._id !== undefined) return stores[String(filter._id)] ? clone(stores[String(filter._id)]) : null;
      const row = Object.values(stores).find((s) => String(s.owner) === String(filter.owner));
      return row ? clone(row) : null;
    });
  StoreModel.find = (filter: any) =>
    chain(() =>
      Object.values(stores)
        .filter((s) => (filter.owner !== undefined ? String(s.owner) === String(filter.owner) : (filter._id?.$in ?? []).map(String).includes(String(s._id))))
        .map(clone),
    );
  StoreModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = stores[String(filter._id)];
      if (!row || String(row.owner) !== String(filter.owner)) return null;
      if ('updatedAt' in filter && row.updatedAt.getTime() !== filter.updatedAt.getTime()) return null;
      Object.assign(row, clone(update.$set ?? {}));
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      return clone(row);
    });

  MemberModel.find = (filter: any) => chain(() => members.filter((m) => matches(m, filter)).map(clone));
  MemberModel.findOne = (filter: any) => chain(() => {
    const row = members.find((m) => matches(m, filter));
    return row ? clone(row) : null;
  });
  MemberModel.countDocuments = async (filter: any) => members.filter((m) => matches(m, filter)).length;
  MemberModel.create = async (doc: Row) => {
    if (doc.status === 'invited' && members.some((m) => String(m.store) === String(doc.store) && m.email === doc.email && m.status === 'invited')) throw dup();
    if (doc.tokenHash && members.some((m) => m.tokenHash === doc.tokenHash)) throw dup();
    seq += 1;
    const row = { _id: '65a0000000000000000b' + String(seq).padStart(4, '0'), createdAt: new Date(T0.getTime() + seq * 1000), updatedAt: T0, ...clone(flat(doc)) };
    members.push(row);
    return clone(row);
  };
  MemberModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = members.find((m) => matches(m, filter));
      if (!row) return null;
      const set = flat(update.$set ?? {});
      const next = set.user;
      if (next !== undefined && members.some((m) => m !== row && String(m.store) === String(row.store) && String(m.user) === String(next))) throw dup();
      Object.assign(row, clone(set));
      for (const key of Object.keys(update.$unset ?? {})) delete row[key];
      for (const [key, by] of Object.entries(update.$inc ?? {})) row[key] = (row[key] ?? 0) + (by as number);
      return clone(row);
    });
  MemberModel.findOneAndDelete = (filter: any) =>
    chain(() => {
      const index = members.findIndex((m) => matches(m, filter));
      if (index < 0) return null;
      return clone(members.splice(index, 1)[0]!);
    });

  UserModel.findById = (id: unknown) => chain(() => (users[String(id)] ? clone(users[String(id)]) : null));
  UserModel.find = (filter: any) => chain(() => Object.values(users).filter((u) => (filter._id?.$in ?? []).map(String).includes(String(u._id))).map(clone));
  AuditModel.create = async (doc: Row) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  OutboxModel.create = async (doc: Row) => {
    if (doc.dedupeKey !== undefined && outbox.some((r) => r.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    outbox.push(row);
    return row;
  };
  OutboxModel.findOne = (filter: any) => chain(() => outbox.find((r) => r.dedupeKey === filter.dedupeKey) ?? null);
  // The first send claims nothing, so the provider is never asked.
  OutboxModel.findOneAndUpdate = () => chain(() => null);

  restore = () => {
    (mongoose as any).connect = saved.connect;
    if (savedReadyState) Object.defineProperty(mongoose.connection, 'readyState', savedReadyState);
    else delete (mongoose.connection as unknown as Row).readyState;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.member)) MemberModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.user)) UserModel[m] = fn;
    AuditModel.create = saved.audit;
    for (const [m, fn] of Object.entries(saved.outbox)) OutboxModel[m] = fn;
    setSessionUserLoader(null);
    setPlanLoader(null);
    setMembershipLoader(null);
    setMembershipListLoader(null);
  };
});

afterEach(() => restore());

// ------------------------------------------------------------------------------------------------------------ helpers

const sha = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');

function call(handler: Handler, method: string, path: string, options: { token?: string | null; body?: unknown; store?: string; memberId?: string; headers?: Record<string, string> } = {}) {
  const token = options.token === undefined ? tokens.owner : options.token;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.authorization = 'Bearer ' + token;
  const store = options.store ?? STORE_A;
  return handler(
    new NextRequest('http://seller.test' + path, { method, headers, body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body) }),
    { params: Promise.resolve({ id: store, ...(options.memberId === undefined ? {} : { memberId: options.memberId }) }) },
  );
}

const json = async (res: Response) => (await res.json()) as any;
const team = (options: Parameters<typeof call>[3] = {}) => call(teamGET, 'GET', '/api/stores/' + (options.store ?? STORE_A) + '/team', options);
const invite = (body: unknown, options: Parameters<typeof call>[3] = {}) => call(inviteRoute, 'POST', '/api/stores/' + (options.store ?? STORE_A) + '/team/invite', { ...options, body });
const member = (action: 'resend' | 'disable' | 'enable' | 'remove' | 'role', id: string, body: unknown, options: Parameters<typeof call>[3] = {}) => {
  const handler = { resend: resendPOST, disable: disablePOST, enable: enablePOST, remove: removePOST, role: memberPATCH }[action];
  const path = '/api/stores/' + (options.store ?? STORE_A) + '/team/' + id + (action === 'role' ? '' : '/' + action);
  return call(handler, action === 'role' ? 'PATCH' : 'POST', path, { ...options, memberId: id, body });
};
const accept = (token: unknown, who: string | null = 'invitee') => call(acceptPOST, 'POST', '/api/team/accept', { token: who === null ? null : tokens[who], body: { token } });
const info = (token: string | null) =>
  call(infoGET, 'GET', '/api/team/invite' + (token === null ? '' : '?token=' + encodeURIComponent(token)), { token: null });
const patch = (body: unknown, who: string, store = STORE_A) => call(settingsPATCH, 'PATCH', '/api/stores/' + store, { token: tokens[who], store, body });

/** Seeds an active member of STORE_A. */
function seedMember(user: string, role: string, status = 'active', fields: Row = {}): Row {
  seq += 1;
  const row = {
    _id: '65a0000000000000000c' + String(seq).padStart(4, '0'),
    store: STORE_A,
    user,
    email: users[user]!.email,
    role,
    status,
    invitedBy: OWNER,
    revision: 0,
    createdAt: new Date(T0.getTime() + seq * 1000),
    updatedAt: T0,
    ...fields,
  };
  members.push(row);
  return row;
}

/** Invites an address through the route and returns the raw token read out of the queued email (as the invitee would from the link). */
async function inviteAndToken(email: string, role = 'manager', options: Parameters<typeof call>[3] = {}): Promise<{ id: string; raw: string; revision: number }> {
  const res = await invite({ email, role }, options);
  assert.equal(res.status, 201);
  await settle();
  const body = await json(res);
  const mail = outbox.filter((r) => r.template === 'staff_invite' && r.to === email.toLowerCase()).at(-1)!;
  const raw = /accept-invite\?token=([A-Za-z0-9_-]{43})/.exec(mail.bodyText)![1]!;
  return { id: body.member.id, raw, revision: body.member.revision };
}

// ============================================================================================================ the invite

test('the owner invites: an invited member, the email queued with a 7 day link, only the HASH of the token stored, nothing secret in the answer or the audit', async () => {
  const res = await invite({ email: '  Sara@Example.PK ', role: 'support' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  await settle();
  const body = await json(res);
  assert.equal(body.member.email, 'sara@example.pk', 'stored lower case');
  assert.equal(body.member.role, 'support');
  assert.equal(body.member.status, 'invited');
  assert.equal(body.member.inviteExpired, false);
  assert.equal(body.member.revision, 0);

  const row = members[0]!;
  assert.equal(String(row.store), STORE_A);
  assert.equal(String(row.invitedBy), OWNER);
  assert.equal(row.user, undefined, 'no account yet');
  assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.99 && days <= 7.001, 'the invite lasts 7 days: ' + days);

  const mail = outbox.find((r) => r.template === 'staff_invite')!;
  assert.equal(mail.to, 'sara@example.pk');
  const raw = /https:\/\/seller\.markazify\.com\/accept-invite\?token=([A-Za-z0-9_-]{43})/.exec(mail.bodyText)?.[1];
  assert.ok(raw, 'the link carries the raw token');
  assert.equal(sha(raw!), row.tokenHash, 'the row holds only the hash of the token in the link');
  assert.ok(mail.bodyText.includes('Zara Lawn'));
  assert.ok(mail.bodyText.includes('Support'));
  assert.ok(mail.bodyText.includes('Ayesha Khan'), 'who invited');

  for (const text of [JSON.stringify(body), JSON.stringify(audits)]) {
    assert.equal(text.includes(raw!), false, 'the raw token is never answered or audited');
    assert.equal(text.includes(row.tokenHash), false, 'nor is its hash');
  }
  assert.equal(audits.at(-1)!.action, 'team.invite');
  assert.equal(audits.at(-1)!.actorId, 'seller:' + OWNER);
  assert.equal(audits.at(-1)!.details.actorRole, 'owner');
  assert.equal(audits.at(-1)!.details.invitedRole, 'support');
});

test('a bad invite body is a 400 that names the field and writes nothing: no email, a role that is not a staff role, an unknown key', async () => {
  const attempts: Array<[unknown, string]> = [
    [{ role: 'staff' }, 'email'],
    [{ email: 'not-an-email', role: 'staff' }, 'email'],
    [{ email: 'a@b.pk' }, 'role'],
    [{ email: 'a@b.pk', role: 'owner' }, 'role'],
    [{ email: 'a@b.pk', role: 'admin' }, 'role'],
    [{ email: 'a@b.pk', role: 'Manager' }, 'role'],
    [{ email: 'a@b.pk', role: 'staff', store: STORE_B }, 'store'],
    [{ email: 'a@b.pk', role: 'staff', status: 'active' }, 'status'],
    [{ email: 'a@b.pk', role: 'staff', tokenHash: 'a'.repeat(64) }, 'tokenHash'],
    ['not json', 'body'],
  ];
  for (const [body, field] of attempts) {
    const res = await invite(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await json(res)).field, field, JSON.stringify(body));
  }
  assert.equal(members.length, 0);
  assert.equal(outbox.length, 0);
});

test("the owner's own email cannot be invited to the same store (any spelling), but is fine for another seller's store", async () => {
  for (const email of ['owner@zara.pk', 'OWNER@Zara.PK', ' owner@zara.pk ']) {
    const res = await invite({ email, role: 'manager' });
    assert.equal(res.status, 409, email);
    const body = await json(res);
    assert.equal(body.code, 'OWNER_EMAIL');
    assert.equal(body.field, 'email');
  }
  assert.equal(members.length, 0);
  // Seller B may invite Seller A: it is only their own store that the owner address is refused for.
  assert.equal((await invite({ email: 'owner@zara.pk', role: 'staff' }, { token: tokens.ownerB, store: STORE_B })).status, 201);
});

test('one invite per email per store: a second invite is 409 INVITE_EXISTS, an active or disabled member is 409 ALREADY_MEMBER, another store is free', async () => {
  assert.equal((await invite({ email: 'sara@example.pk', role: 'staff' })).status, 201);
  const again = await invite({ email: 'SARA@example.pk', role: 'manager' });
  assert.equal(again.status, 409);
  assert.equal((await json(again)).code, 'INVITE_EXISTS');
  assert.equal(members.length, 1);
  seedMember(MANAGER, 'manager');
  const active = await invite({ email: 'manager@zara.pk', role: 'staff' });
  assert.equal(active.status, 409);
  assert.equal((await json(active)).code, 'ALREADY_MEMBER');
  members[1]!.status = 'disabled';
  assert.equal((await json(await invite({ email: 'manager@zara.pk', role: 'staff' }))).code, 'ALREADY_MEMBER');
  assert.equal((await invite({ email: 'sara@example.pk', role: 'staff' }, { token: tokens.ownerB, store: STORE_B })).status, 201, 'the same address in another store is a different invite');
});

test('two invites at once: the unique {store, email} index lets one win, the other is 409 INVITE_EXISTS', async () => {
  const results = await Promise.all([invite({ email: 'race@example.pk', role: 'staff' }), invite({ email: 'race@example.pk', role: 'staff' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(members.length, 1);
});

// ============================================================================================================ the seats

test('the plan seats: an invite is refused with 403 PLAN_LIMIT_REACHED at the limit; invited and active members hold a seat, a disabled one does not', async () => {
  seatLimit = 2;
  assert.equal((await invite({ email: 'one@example.pk', role: 'staff' })).status, 201, 'invited holds a seat');
  seedMember(MANAGER, 'manager');
  const full = await invite({ email: 'three@example.pk', role: 'staff' });
  assert.equal(full.status, 403);
  const body = await json(full);
  assert.equal(body.code, 'PLAN_LIMIT_REACHED');
  assert.equal(body.limitKind, 'staffSeats');
  assert.equal(body.limit, 2);
  assert.equal(body.used, 2);
  assert.match(body.errors[0].message, /staff seats/);
  assert.equal(members.length, 2, 'nothing was written');
  members.find((m) => m.user === MANAGER)!.status = 'disabled';
  assert.equal((await invite({ email: 'three@example.pk', role: 'staff' })).status, 201, 'a disabled member released the seat');
});

test('the Free plan (0 seats) refuses the first invite; an unlimited plan (null) never refuses', async () => {
  seatLimit = 0;
  const res = await invite({ email: 'one@example.pk', role: 'staff' });
  assert.equal(res.status, 403);
  assert.equal((await json(res)).code, 'PLAN_LIMIT_REACHED');
  assert.equal(members.length, 0);
  seatLimit = null;
  for (const email of ['a@example.pk', 'b@example.pk', 'c@example.pk', 'd@example.pk', 'e@example.pk']) assert.equal((await invite({ email, role: 'staff' })).status, 201);
});

test('the seat check runs after the ownership checks: a stranger hears 403 (not a plan message) and an owner of another store is not counted against this one', async () => {
  seatLimit = 0;
  const stranger = await invite({ email: 'x@example.pk', role: 'staff' }, { token: tokens.stranger });
  assert.equal(stranger.status, 403);
  assert.equal((await json(stranger)).code, undefined, 'the plain 403 of a store that is not yours');
  seatLimit = 1;
  seedMember(MANAGER, 'manager');
  assert.equal((await invite({ email: 'x@example.pk', role: 'staff' }, { token: tokens.ownerB, store: STORE_B })).status, 201, 'seats are counted per store');
});

test('enabling a disabled member takes a seat again: a full team refuses it 403 PLAN_LIMIT_REACHED', async () => {
  seatLimit = 1;
  const disabled = seedMember(STAFF, 'staff', 'disabled');
  assert.equal((await invite({ email: 'new1@example.pk', role: 'staff' })).status, 201);
  const res = await member('enable', String(disabled._id), { revision: 0 });
  assert.equal(res.status, 403);
  assert.equal((await json(res)).code, 'PLAN_LIMIT_REACHED');
  assert.equal(disabled.status, 'disabled');
  seatLimit = 5;
  assert.equal((await member('enable', String(disabled._id), { revision: 0 })).status, 200);
  assert.equal(disabled.status, 'active');
});

// ============================================================================================================ accepting

test('accepting: a signed-in user with the invited email becomes an ACTIVE member; the token is cleared, the owner is told, the audit names the member', async () => {
  const { id, raw } = await inviteAndToken('new@zara.pk', 'manager');
  const res = await accept(raw);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.deepEqual(body, { storeId: STORE_A, storeName: 'Zara Lawn', role: 'manager' });
  const row = members.find((m) => String(m._id) === id)!;
  assert.equal(row.status, 'active');
  assert.equal(String(row.user), INVITEE);
  assert.ok(row.acceptedAt instanceof Date);
  assert.equal(row.tokenHash, undefined, 'the hash is gone: the link works once');
  assert.equal(row.revision, 1);
  await settle();
  const told = outbox.find((r) => r.template === 'staff_invite_accepted')!;
  assert.equal(told.to, 'owner@zara.pk');
  assert.ok(told.bodyText.includes('new@zara.pk'));
  assert.ok(told.bodyText.includes('Manager'));
  assert.equal(audits.at(-1)!.action, 'team.accept');
  assert.equal(audits.at(-1)!.actorId, 'seller:' + INVITEE);
  assert.equal(audits.at(-1)!.details.role, 'manager');
  assert.equal(JSON.stringify(audits).includes(raw), false);
});

test('a reused token, an expired token, an unknown token, a malformed token and a wrong account all get the SAME neutral 400 INVITE_INVALID', async () => {
  const { id, raw } = await inviteAndToken('new@zara.pk');
  assert.equal((await accept(raw)).status, 200);
  const answers: unknown[] = [];
  answers.push(await accept(raw)); // reused
  const expired = await inviteAndToken('late@zara.pk');
  members.find((m) => String(m._id) === expired.id)!.expiresAt = new Date(Date.now() - 1000);
  users[STAFF]!.email = 'late@zara.pk';
  answers.push(await accept(expired.raw, 'staff')); // expired (right account)
  answers.push(await accept('A'.repeat(43))); // unknown, well formed
  answers.push(await accept('x'.repeat(25))); // malformed (long enough for the body schema, not a token)
  const other = await inviteAndToken('other@zara.pk');
  answers.push(await accept(other.raw, 'support')); // wrong account (another address)
  const texts = new Set<string>();
  for (const res of answers as Response[]) {
    assert.equal(res.status, 400);
    const body = await json(res);
    assert.equal(body.code, 'INVITE_INVALID');
    texts.add(JSON.stringify(body.errors));
  }
  assert.equal(texts.size, 1, 'one message for every refusal: a guess learns nothing');
  void id;
});

test('a wrong account does NOT use the token up: the right account can still accept afterwards', async () => {
  const { id, raw } = await inviteAndToken('new@zara.pk', 'support');
  assert.equal((await accept(raw, 'staff')).status, 400, 'the staff account is not the invited address');
  assert.equal((await accept(raw, 'stranger')).status, 400);
  const row = members.find((m) => String(m._id) === id)!;
  assert.equal(row.status, 'invited');
  assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal((await accept(raw, 'invitee')).status, 200);
});

test('the email match ignores case: an account with another spelling of the invited address accepts', async () => {
  users[INVITEE]!.email = 'NEW@Zara.PK';
  const { raw } = await inviteAndToken('new@zara.pk');
  assert.equal((await accept(raw)).status, 200);
});

test('two accepts at once: one wins, the other is the neutral 400 (a compare-and-set on the token)', async () => {
  const { raw } = await inviteAndToken('new@zara.pk');
  const results = await Promise.all([accept(raw), accept(raw)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(members.filter((m) => m.status === 'active').length, 1);
});

test('accepting needs a session: no login is 401 and an admin session is 403; a body with another key is 400', async () => {
  const { raw } = await inviteAndToken('new@zara.pk');
  assert.equal((await accept(raw, null)).status, 401);
  assert.equal((await accept(raw, 'admin')).status, 403);
  assert.equal((await call(acceptPOST, 'POST', '/api/team/accept', { token: tokens.invitee, body: { token: raw, store: STORE_B } })).status, 400);
  assert.equal((await call(acceptPOST, 'POST', '/api/team/accept', { token: tokens.invitee, body: {} })).status, 400);
  assert.equal(members[0]!.status, 'invited');
});

test('a person already a member of the store through another row cannot accept a second invite there: the neutral 400', async () => {
  seedMember(INVITEE, 'staff', 'active', { email: 'old@zara.pk' });
  const { raw } = await inviteAndToken('new@zara.pk');
  const res = await accept(raw);
  assert.equal(res.status, 400);
  assert.equal((await json(res)).code, 'INVITE_INVALID');
});

test('one user may be a member of several stores, with a role in each; the workspace and users/me list them (owned first), with the role', async () => {
  const a = await inviteAndToken('new@zara.pk', 'manager');
  const b = await inviteAndToken('new@zara.pk', 'support', { token: tokens.ownerB, store: STORE_B });
  assert.equal((await accept(a.raw)).status, 200);
  assert.equal((await accept(b.raw)).status, 200);
  const workspace = await json(await call(workspaceGET, 'GET', '/api/workspace', { token: tokens.invitee }));
  assert.deepEqual(workspace.stores.map((s: Row) => [s.id, s.role]), [[STORE_A, 'manager'], [STORE_B, 'support']]);
  assert.equal(workspace.limits.used, 0, 'a store you only work in is not one you own');
  const me = await json(await call(meGET, 'GET', '/api/users/me', { token: tokens.invitee }));
  assert.deepEqual(me.user.stores, [], 'stores stays the OWNED ids, as every caller has always read it');
  assert.deepEqual(me.user.storeAccess, [{ id: STORE_A, role: 'manager' }, { id: STORE_B, role: 'support' }]);
});

test('the workspace and users/me of an owner carry role owner; an invited, disabled or removed member sees no store', async () => {
  const owner = await json(await call(workspaceGET, 'GET', '/api/workspace', { token: tokens.owner }));
  assert.deepEqual(owner.stores.map((s: Row) => [s.id, s.role]), [[STORE_A, 'owner']]);
  assert.equal(owner.limits.used, 1);
  const me = await json(await call(meGET, 'GET', '/api/users/me', { token: tokens.owner }));
  assert.deepEqual(me.user.storeAccess, [{ id: STORE_A, role: 'owner' }]);
  assert.deepEqual(me.user.stores, [STORE_A]);
  for (const status of ['invited', 'disabled']) {
    members.length = 0;
    seedMember(MANAGER, 'manager', status, status === 'invited' ? { user: undefined } : {});
    const w = await json(await call(workspaceGET, 'GET', '/api/workspace', { token: tokens.manager }));
    assert.deepEqual(w.stores, [], status);
    const m = await json(await call(meGET, 'GET', '/api/users/me', { token: tokens.manager }));
    assert.deepEqual(m.user.storeAccess, [], status);
  }
  members.length = 0;
  assert.deepEqual((await json(await call(workspaceGET, 'GET', '/api/workspace', { token: tokens.manager }))).stores, [], 'removed: no row at all');
});

test('the invite info route shows the store, role and email to a holder of a valid token with no session; every other token is { valid: false }', async () => {
  const { id, raw } = await inviteAndToken('new@zara.pk', 'staff');
  const ok = await info(raw);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await json(ok), { valid: true, storeName: 'Zara Lawn', role: 'staff', email: 'new@zara.pk' });
  for (const bad of ['A'.repeat(43), 'short', '', 'x'.repeat(500)]) assert.deepEqual(await json(await info(bad)), { valid: false }, bad);
  assert.deepEqual(await json(await info(null)), { valid: false });
  members.find((m) => String(m._id) === id)!.expiresAt = new Date(Date.now() - 1000);
  assert.deepEqual(await json(await info(raw)), { valid: false }, 'expired');
  members.find((m) => String(m._id) === id)!.expiresAt = new Date(Date.now() + 100000);
  assert.equal((await accept(raw)).status, 200);
  assert.deepEqual(await json(await info(raw)), { valid: false }, 'used');
});

// ============================================================================================================ resend, role, disable, enable, remove

test('resend: a new link, the OLD link is dead at once, the revision moves, a new email is queued; a stale revision is 409; only an open invitation can be resent', async () => {
  const first = await inviteAndToken('new@zara.pk', 'manager');
  const res = await member('resend', first.id, { revision: first.revision });
  assert.equal(res.status, 200);
  await settle();
  assert.equal((await json(res)).member.revision, 1);
  const mails = outbox.filter((r) => r.template === 'staff_invite');
  assert.equal(mails.length, 2);
  const second = /token=([A-Za-z0-9_-]{43})/.exec(mails[1]!.bodyText)![1]!;
  assert.notEqual(second, first.raw);
  assert.equal((await accept(first.raw)).status, 400, 'the old link no longer works');
  assert.equal((await info(first.raw).then(json)).valid, false);
  assert.equal(audits.at(-1)!.action, 'team.resend');
  assert.equal((await member('resend', first.id, { revision: 0 })).status, 409, 'revision 0 was read before the resend');
  assert.equal((await accept(second)).status, 200, 'the new link works');
  assert.equal((await member('resend', first.id, { revision: 2 })).status, 409, 'an accepted invitation cannot be resent');
});

test('resend revives an expired invitation with a new 7 day link', async () => {
  const first = await inviteAndToken('new@zara.pk');
  members[0]!.expiresAt = new Date(Date.now() - 1000);
  const listed = (await json(await team())).members[0];
  assert.equal(listed.inviteExpired, true, 'the list says the link stopped working');
  assert.equal((await member('resend', first.id, { revision: 0 })).status, 200);
  assert.ok(members[0]!.expiresAt.getTime() > Date.now() + 6.9 * 86_400_000);
  assert.equal((await json(await team())).members[0].inviteExpired, false);
});

test('role change: one compare-and-set on the revision; a stale revision is 409 and changes nothing; the role must be a staff role', async () => {
  const row = seedMember(MANAGER, 'manager');
  const ok = await member('role', String(row._id), { role: 'support', revision: 0 });
  assert.equal(ok.status, 200);
  const body = await json(ok);
  assert.equal(body.member.role, 'support');
  assert.equal(body.member.revision, 1);
  assert.equal(row.role, 'support');
  assert.deepEqual([audits.at(-1)!.action, audits.at(-1)!.details.from, audits.at(-1)!.details.to, audits.at(-1)!.details.actorRole], ['team.role', 'manager', 'support', 'owner']);
  const stale = await member('role', String(row._id), { role: 'staff', revision: 0 });
  assert.equal(stale.status, 409);
  assert.equal((await json(stale)).code, 'MEMBER_CHANGED');
  assert.equal(row.role, 'support');
  for (const role of ['owner', 'admin', 'x']) assert.equal((await member('role', String(row._id), { role, revision: 1 })).status, 400, role);
  assert.equal((await member('role', String(row._id), { role: 'staff' })).status, 400, 'the revision is required');
});

test('disable: the member is refused on the VERY NEXT request (status read from the database every time); enable gives access back', async () => {
  const row = seedMember(MANAGER, 'manager');
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 17 } }, 'manager')).status, 200, 'an active manager changes the tax');
  const off = await member('disable', String(row._id), { revision: 0 });
  assert.equal(off.status, 200);
  assert.equal((await json(off)).member.status, 'disabled');
  const refused = await patch({ tax: { enabled: false } }, 'manager');
  assert.equal(refused.status, 403, 'the next request after the disable');
  assert.equal(stores[STORE_A]!.storefront.tax.enabled, true, 'nothing was written');
  assert.equal(audits.find((a) => a.action === 'team.disable')!.details.actorRole, 'owner');
  assert.equal((await member('disable', String(row._id), { revision: 1 })).status, 409, 'only an active member can be disabled');
  assert.equal((await member('enable', String(row._id), { revision: 1 })).status, 200);
  assert.equal((await patch({ tax: { enabled: false } }, 'manager')).status, 200, 'and back');
});

test('disable and enable refuse an invitation (409 MEMBER_STATE); an invitation is removed, not disabled', async () => {
  const first = await inviteAndToken('new@zara.pk');
  const res = await member('disable', first.id, { revision: 0 });
  assert.equal(res.status, 409);
  assert.equal((await json(res)).code, 'MEMBER_STATE');
  assert.equal((await member('enable', first.id, { revision: 0 })).status, 409);
});

test('remove: the row is deleted, the person is refused at once and told by email; removing an open invitation sends no "access removed" email and kills its link', async () => {
  const row = seedMember(MANAGER, 'manager');
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 5 } }, 'manager')).status, 200);
  const res = await member('remove', String(row._id), { revision: 0 });
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { removed: true });
  await settle();
  assert.equal(members.length, 0);
  assert.equal((await patch({ tax: { enabled: false } }, 'manager')).status, 403);
  const told = outbox.find((r) => r.template === 'staff_access_removed')!;
  assert.equal(told.to, 'manager@zara.pk');
  assert.ok(told.bodyText.includes('Zara Lawn'));
  assert.equal(audits.at(-1)!.action, 'team.remove');

  outbox.length = 0;
  const pending = await inviteAndToken('new@zara.pk');
  assert.equal((await member('remove', pending.id, { revision: 0 })).status, 200);
  await settle();
  assert.equal(outbox.some((r) => r.template === 'staff_access_removed'), false);
  assert.equal((await accept(pending.raw)).status, 400, 'the removed invitation link is dead');
  assert.equal((await member('remove', pending.id, { revision: 0 })).status, 404, 'already gone');
});

test('a stale revision on remove is 409 and the row stays', async () => {
  const row = seedMember(MANAGER, 'manager');
  row.revision = 3;
  const res = await member('remove', String(row._id), { revision: 2 });
  assert.equal(res.status, 409);
  assert.equal(members.length, 1);
});

test('the list: members with role and status, the seats against the plan, names of those who accepted, never a token hash', async () => {
  seedMember(MANAGER, 'manager');
  await inviteAndToken('new@zara.pk', 'support');
  const res = await team();
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.members.length, 2);
  assert.deepEqual(body.seats, { used: 2, limit: 3 });
  const active = body.members.find((m: Row) => m.status === 'active');
  assert.equal(active.name, 'Mona');
  assert.equal(active.email, 'manager@zara.pk');
  assert.equal(JSON.stringify(body).includes('tokenHash'), false);
  assert.equal(JSON.stringify(body).includes(members[1]!.tokenHash), false);
  seatLimit = null;
  assert.equal((await json(await team())).seats.limit, null);
});

// ============================================================================================================ who may call the team routes

const TEAM_CALLS: Array<[string, (token: string | null, extra?: Row) => Promise<Response>]> = [
  ['list', (token) => team({ token })],
  ['invite', (token) => invite({ email: 'z@example.pk', role: 'staff' }, { token })],
  ['role', (token, extra) => member('role', extra!.id, { role: 'staff', revision: 0 }, { token })],
  ['resend', (token, extra) => member('resend', extra!.id, { revision: 0 }, { token })],
  ['disable', (token, extra) => member('disable', extra!.id, { revision: 0 }, { token })],
  ['enable', (token, extra) => member('enable', extra!.id, { revision: 0 }, { token })],
  ['remove', (token, extra) => member('remove', extra!.id, { revision: 0 }, { token })],
];

test('a manager, staff and support member cannot call ANY team route: 403 CAPABILITY_DENIED, and nothing changes', async () => {
  const target = seedMember(STAFF, 'staff');
  seedMember(MANAGER, 'manager');
  seedMember(SUPPORT, 'support');
  const before = JSON.stringify(members);
  for (const who of ['manager', 'staff', 'support']) {
    for (const [name, run] of TEAM_CALLS) {
      const res = await run(tokens[who]!, { id: String(target._id) });
      assert.equal(res.status, 403, who + ' ' + name);
      assert.equal((await json(res)).code, 'CAPABILITY_DENIED', who + ' ' + name);
    }
  }
  assert.equal(JSON.stringify(members), before, 'not a field of a member changed');
  assert.equal(audits.length, 0);
  assert.equal(outbox.length, 0);
});

test('an invited member, a disabled member and a stranger are refused on every team route; no login is 401; an admin session is 403', async () => {
  const target = seedMember(STAFF, 'staff');
  seedMember(MANAGER, 'manager', 'disabled');
  seedMember(SUPPORT, 'support', 'invited', { user: undefined });
  for (const who of ['manager', 'support', 'stranger']) {
    for (const [name, run] of TEAM_CALLS) assert.equal((await run(tokens[who]!, { id: String(target._id) })).status, 403, who + ' ' + name);
  }
  for (const [name, run] of TEAM_CALLS) {
    assert.equal((await run(null, { id: String(target._id) })).status, 401, 'no login ' + name);
    assert.equal((await run(tokens.admin!, { id: String(target._id) })).status, 403, 'admin ' + name);
  }
  assert.equal(target.status, 'active');
  assert.equal(members.length, 3);
});

test('isolation: Seller B cannot read or change Store A team, a member id of Store A under Store B is 404, a malformed id is 404', async () => {
  const target = seedMember(STAFF, 'staff');
  for (const [name, run] of TEAM_CALLS) {
    const foreign = await run(tokens.ownerB!, { id: String(target._id) });
    assert.equal(foreign.status, 403, 'store A with B session: ' + name);
  }
  // B's own store, A's member id: a foreign record is a 404 (existence is not revealed).
  for (const action of ['role', 'resend', 'disable', 'enable', 'remove'] as const) {
    const res = await member(action, String(target._id), action === 'role' ? { role: 'staff', revision: 0 } : { revision: 0 }, { token: tokens.ownerB, store: STORE_B });
    assert.equal(res.status, 404, action);
  }
  assert.equal((await member('remove', 'nope', { revision: 0 })).status, 404);
  assert.equal((await team({ store: 'nope' })).status, 404);
  assert.equal((await team({ token: tokens.ownerB, store: STORE_B })).status, 200, "B's own list");
  assert.deepEqual((await json(await team({ token: tokens.ownerB, store: STORE_B }))).members, [], "A's member never shows in B's list");
  assert.equal(target.status, 'active');
  assert.equal(members.length, 1);
  assert.equal(JSON.stringify(await json(await team({ token: tokens.ownerB, store: STORE_B }))).includes(String(target._id)), false);
});

test('the store in the path and the x-store-id header must agree: a header naming another store is 403', async () => {
  const res = await team({ headers: { 'x-store-id': STORE_B } });
  assert.equal(res.status, 403);
});

test('the routes read nothing before the session and the body are checked: no login and a bad body never reach the database', async () => {
  let reads = 0;
  const original = MemberModel.find;
  MemberModel.find = (...args: unknown[]) => {
    reads += 1;
    return original(...args);
  };
  assert.equal((await team({ token: null })).status, 401);
  assert.equal((await invite({ email: 'bad', role: 'staff' })).status, 400);
  assert.equal(reads, 0);
});

// ============================================================================================================ the capability of the settings groups

test('the tax group: the owner and a manager may change it; staff and support may not (403 CAPABILITY_DENIED) and nothing is written', async () => {
  seedMember(MANAGER, 'manager');
  seedMember(STAFF, 'staff');
  seedMember(SUPPORT, 'support');
  const owner = await patch({ tax: { enabled: true, ratePercent: 17, mode: 'inclusive', label: 'GST' } }, 'owner');
  assert.equal(owner.status, 200);
  assert.deepEqual(stores[STORE_A]!.storefront.tax, { enabled: true, ratePercent: 17, mode: 'inclusive', label: 'GST' });
  assert.equal(audits.at(-1)!.details.actorRole, 'owner');
  const manager = await patch({ tax: { ratePercent: 5 } }, 'manager');
  assert.equal(manager.status, 200);
  assert.equal(stores[STORE_A]!.storefront.tax.ratePercent, 5);
  assert.equal(audits.at(-1)!.actorId, 'seller:' + MANAGER + ':manager', 'S8-B3: a member action records the user id AND the role');
  assert.equal(audits.at(-1)!.details.actorRole, 'manager');
  assert.deepEqual(audits.at(-1)!.details.groups, ['tax']);
  for (const who of ['staff', 'support']) {
    const res = await patch({ tax: { ratePercent: 99 } }, who);
    assert.equal(res.status, 403, who);
    assert.equal((await json(res)).code, 'CAPABILITY_DENIED', who);
  }
  assert.equal(stores[STORE_A]!.storefront.tax.ratePercent, 5, 'staff and support wrote nothing');
});

test('an invited or removed member and a stranger cannot change the tax; Seller B cannot change Store A tax', async () => {
  seedMember(MANAGER, 'manager', 'invited', { user: undefined });
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 17 } }, 'manager')).status, 403);
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 17 } }, 'stranger')).status, 403);
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 17 } }, 'ownerB')).status, 403);
  assert.equal(stores[STORE_A]!.storefront.tax, undefined);
});

test('a manager cannot change payments, fraud, domain or payout, alone or with the tax group in the same save; nothing is written', async () => {
  seedMember(MANAGER, 'manager');
  const before = JSON.stringify(stores[STORE_A]);
  for (const body of [
    { payments: { codEnabled: true } },
    { fraud: { codConfirmation: 'all' } },
    { domain: { redirectToCustomDomain: true } },
    { tax: { enabled: true, ratePercent: 17 }, payments: { codEnabled: true } },
    { tax: { enabled: true, ratePercent: 17 }, fraud: { codConfirmation: 'all' } },
  ]) {
    const res = await patch(body, 'manager');
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.equal((await json(res)).code, 'CAPABILITY_DENIED', JSON.stringify(body));
  }
  assert.equal(JSON.stringify(stores[STORE_A]), before);
  // The owner still may.
  assert.equal((await patch({ payments: { codEnabled: true } }, 'owner')).status, 200);
});

test('a manager may change the general groups (profile); staff and support may not; a manager never reads the payout account back', async () => {
  seedMember(MANAGER, 'manager');
  seedMember(STAFF, 'staff');
  stores[STORE_A]!.payoutDetails = { method: 'bank', accountTitle: 'Zara Lawn', accountNumber: '12345678901234', bankName: 'HBL' };
  const res = await patch({ profile: { description: 'Lawn and chiffon' } }, 'manager');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.settings.profile.description, 'Lawn and chiffon');
  assert.equal(body.settings.payout, null, 'payouts are owner-only: not even the masked account is answered');
  assert.equal(JSON.stringify(body).includes('1234'), false);
  assert.equal((await patch({ profile: { description: 'x' } }, 'staff')).status, 403);
  assert.equal((await patch({ payout: null }, 'manager')).status, 403, 'removing the payout account is owner-only too');
  assert.equal(stores[STORE_A]!.payoutDetails.accountTitle, 'Zara Lawn');
});

test('the plan check of a settings save is the OWNER plan, whoever saves, and the compare-and-set filter names the store owner', async () => {
  seedMember(MANAGER, 'manager');
  const seen: Row[] = [];
  const original = StoreModel.findOneAndUpdate;
  StoreModel.findOneAndUpdate = (filter: any, ...rest: unknown[]) => {
    seen.push(filter);
    return original(filter, ...rest);
  };
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 10 } }, 'manager')).status, 200);
  assert.equal(String(seen[0]!.owner), OWNER, 'not the manager: the store owner');
  assert.equal(String(seen[0]!._id), STORE_A);
});

// ============================================================================================================ the safe default for routes not swept yet

test('a member is refused 403 NOT_OWNER_YET by a route that names no capability (the settings read): an owner is unchanged', async () => {
  seedMember(MANAGER, 'manager');
  const asMember = await call(settingsGET, 'GET', '/api/stores/' + STORE_A + '/settings', { token: tokens.manager });
  assert.equal(asMember.status, 403);
  assert.equal((await json(asMember)).code, 'NOT_OWNER_YET');
  const asOwner = await call(settingsGET, 'GET', '/api/stores/' + STORE_A + '/settings', { token: tokens.owner });
  assert.equal(asOwner.status, 200);
  const stranger = await call(settingsGET, 'GET', '/api/stores/' + STORE_A + '/settings', { token: tokens.stranger });
  assert.equal(stranger.status, 403);
  assert.equal((await json(stranger)).code, undefined);
});

test('a staff member never sees another store: Store B is 403 for them on the team list, the settings and the tax, and their own store list has Store A only', async () => {
  seedMember(STAFF, 'staff');
  assert.equal((await team({ token: tokens.staff, store: STORE_B })).status, 403);
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 1 } }, 'staff', STORE_B)).status, 403);
  assert.equal((await call(settingsGET, 'GET', '/api/stores/' + STORE_B + '/settings', { token: tokens.staff, store: STORE_B })).status, 403);
  const workspace = await json(await call(workspaceGET, 'GET', '/api/workspace', { token: tokens.staff }));
  assert.deepEqual(workspace.stores.map((s: Row) => s.id), [STORE_A]);
  assert.equal(stores[STORE_B]!.storefront.tax, undefined);
});

test('an invited (not accepted) member has no access to anything: the token alone gives no session and the row gives no role', async () => {
  const { raw } = await inviteAndToken('new@zara.pk', 'manager');
  // The invitee signs in as an unrelated account and tries the store directly: no row for that user, so a stranger.
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 17 } }, 'invitee')).status, 403);
  assert.equal((await team({ token: tokens.invitee })).status, 403);
  assert.equal((await call(workspaceGET, 'GET', '/api/workspace', { token: tokens.invitee }).then(json)).stores.length, 0);
  void raw;
});

test('an accepted manager works end to end: accepts, changes the tax, cannot call the team, and loses access the moment the owner disables them', async () => {
  const { id, raw } = await inviteAndToken('new@zara.pk', 'manager');
  assert.equal((await accept(raw)).status, 200);
  assert.equal((await patch({ tax: { enabled: true, ratePercent: 17 } }, 'invitee')).status, 200);
  assert.equal((await team({ token: tokens.invitee })).status, 403);
  const row = members.find((m) => String(m._id) === id)!;
  assert.equal((await member('disable', id, { revision: row.revision })).status, 200);
  assert.equal((await patch({ tax: { enabled: false } }, 'invitee')).status, 403);
  assert.equal(stores[STORE_A]!.storefront.tax.enabled, true);
});

// ============================================================================================================ S8-B3: the settings by role

const readSettings = async (who: string, store = STORE_A) => call(settingsGET, 'GET', '/api/stores/' + store + '/settings', { token: tokens[who], store });

test('S8-B3 GET settings: every role that works in the store reads it (capability store.view), each its own view; the Tax tab data reaches a manager', async () => {
  seedMember(MANAGER, 'manager');
  seedMember(STAFF, 'staff');
  seedMember(SUPPORT, 'support');
  stores[STORE_A]!.payoutDetails = { method: 'bank', accountTitle: 'Zara Lawn', accountNumber: '12345678901234', bankName: 'HBL' };
  stores[STORE_A]!.paymentSettings = { codEnabled: false, cardEnabled: true, fraud: { codConfirmation: 'all', riskRules: { flaggedCities: ['Karachi'] } } };
  stores[STORE_A]!.storefront = { deliveryRate: 250, tax: { enabled: true, ratePercent: 17, mode: 'inclusive', label: 'GST' } };

  const owner = await json(await readSettings('owner'));
  assert.equal(owner.settings.payout.accountNumberMasked, '••••1234');
  assert.equal(owner.settings.payments.codEnabled, false);

  const manager = await json(await readSettings('manager'));
  assert.equal(manager.settings.payout, null, 'payouts are owner-only: not even masked');
  assert.equal(manager.settings.payments.codEnabled, false, 'a manager sees the payment switches (read only)');
  assert.deepEqual(manager.settings.tax, { enabled: true, ratePercent: 17, mode: 'inclusive', label: 'GST' });

  for (const who of ['staff', 'support']) {
    const res = await readSettings(who);
    assert.equal(res.status, 200, who);
    const body = await json(res);
    const text = JSON.stringify(body);
    assert.equal(body.settings.payout, null, who);
    assert.deepEqual(body.settings.payments, { codEnabled: true, cardEnabled: false, cardAvailable: false }, who + ': neutral defaults, not the stored switches');
    assert.equal(text.includes('Karachi'), false, who + ': no fraud details');
    assert.equal(text.includes('HBL') || text.includes('1234'), false, who + ': no bank data');
    assert.equal(body.settings.delivery.defaultRate, 250, who + ': the store basics stay');
  }
});

test('S8-B3 GET settings: an invited or disabled member and a stranger are refused, and the stored data is not changed by reading', async () => {
  seedMember(MANAGER, 'manager', 'disabled');
  seedMember(SUPPORT, 'support', 'invited', { user: undefined });
  const before = JSON.stringify(stores);
  for (const who of ['manager', 'support', 'stranger', 'ownerB']) assert.equal((await readSettings(who)).status, 403, who);
  assert.equal(JSON.stringify(stores), before);
});

test('S8-B3 GET /api/stores/:id: a member reads the store WITHOUT the payment and courier settings; the owner reads them as always', async () => {
  seedMember(STAFF, 'staff');
  const selects: Array<{ filter: any; select: string }> = [];
  const original = StoreModel.findOne;
  StoreModel.findOne = (filter: any) => {
    const q: any = { select: (fields: string) => (selects.push({ filter, select: fields }), q), sort: () => q, lean: async () => clone(stores[STORE_A]!) };
    return q;
  };
  const storeGET = (await import('../src/app/api/stores/[id]/route')).GET as Handler;
  const asOwner = await call(storeGET, 'GET', '/api/stores/' + STORE_A, { token: tokens.owner });
  const asStaff = await call(storeGET, 'GET', '/api/stores/' + STORE_A, { token: tokens.staff });
  StoreModel.findOne = original;
  assert.equal(asOwner.status, 200);
  assert.equal(asStaff.status, 200);
  assert.match(selects[0]!.select, /paymentSettings/);
  assert.equal(String(selects[0]!.filter.owner), OWNER, 'the owner is read through the owner filter');
  assert.doesNotMatch(selects[1]!.select, /paymentSettings|courierSettings/);
  assert.match(selects[1]!.select, /name/);
  assert.equal(selects[1]!.filter.owner, undefined);
  const stranger = await call(storeGET, 'GET', '/api/stores/' + STORE_A, { token: tokens.stranger });
  assert.equal(stranger.status, 403);
});

test('S8-B3 a branding upload needs settings.write: staff and a stranger are refused before anything is uploaded or written', async () => {
  seedMember(STAFF, 'staff');
  const brandingPOST = (await import('../src/app/api/stores/[id]/branding/[kind]/route')).POST as Handler;
  const send = (who: string) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(8)], { type: 'image/png' }), 'logo.png');
    return brandingPOST(new NextRequest('http://seller.test/api/stores/' + STORE_A + '/branding/logo', { method: 'POST', headers: { authorization: 'Bearer ' + tokens[who] }, body: form }), { params: Promise.resolve({ id: STORE_A, kind: 'logo' }) });
  };
  const staff = await send('staff');
  assert.equal(staff.status, 403);
  assert.equal((await json(staff)).code, 'CAPABILITY_DENIED');
  const stranger = await send('stranger');
  assert.equal(stranger.status, 403);
  assert.equal(stores[STORE_A]!.storefront.logo, undefined);
});
