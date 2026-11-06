import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { buildAuditFilter, parseAuditQuery, toActionFacets, toAuditListEntry } from '@/lib/admin-audit';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const STORE_ID = '65a000000000000000000010';
const ENTRY_ID = '65a000000000000000000099';
const NOW = new Date('2026-10-11T10:00:00.000Z');

const AuditModel = AuditLog as any;
const UserModel = User as any;

let GET: (request: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  GET = (await import('../src/app/api/admin/audit/route')).GET;
});

const calls: { find: any[]; count: any[]; skip: number[] } = { find: [], count: [], skip: [] };

interface Stub {
  role?: string;
  rows?: unknown[];
  total?: number;
  actions?: unknown;
}

function install(stub: Stub): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    userFind: UserModel.find,
    find: AuditModel.find,
    count: AuditModel.countDocuments,
    distinct: AuditModel.distinct,
  };
  for (const list of Object.values(calls)) (list as unknown[]).length = 0;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: stub.role ?? 'admin' }) }) });
  UserModel.find = () => ({ select: () => ({ lean: async () => [{ _id: ADMIN_ID, name: 'Op Erator', email: 'op@example.com' }] }) });
  AuditModel.find = (filter: unknown) => {
    calls.find.push(filter);
    const q: any = { sort: () => q, skip: (n: number) => (calls.skip.push(n), q), limit: () => q, lean: async () => stub.rows ?? [] };
    return q;
  };
  AuditModel.countDocuments = async (filter: unknown) => (calls.count.push(filter), stub.total ?? (stub.rows ?? []).length);
  AuditModel.distinct = async () => stub.actions ?? [];
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    UserModel.find = originals.userFind;
    AuditModel.find = originals.find;
    AuditModel.countDocuments = originals.count;
    AuditModel.distinct = originals.distinct;
  };
}

async function request(path: string, token?: string | null): Promise<Request> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  return new Request('http://admin.test' + path, { headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });
}

const row = {
  _id: ENTRY_ID,
  action: 'store.suspend',
  entity: 'store',
  entityId: STORE_ID,
  actorId: ADMIN_ID,
  createdAt: NOW,
  details: { reason: 'chargebacks', note: 'see ticket', before: { status: 'active' }, after: { status: 'suspended' } },
};

test('parseAuditQuery applies defaults and refuses a malformed action, page, or search', () => {
  assert.deepEqual(parseAuditQuery(new URLSearchParams()), { ok: true, query: { page: 1, limit: 20, q: null, action: null } });
  assert.equal((parseAuditQuery(new URLSearchParams('action=store.suspend')) as any).query.action, 'store.suspend');
  for (const bad of ['action=$ne', 'action=a b', 'action=' + 'a'.repeat(65), 'page=0', 'limit=101', 'q=' + 'a'.repeat(101)]) {
    assert.equal(parseAuditQuery(new URLSearchParams(bad)).ok, false, bad);
  }
});

test('the audit filter matches an id exactly, other text literally, and combines with an action', () => {
  assert.deepEqual(buildAuditFilter({ page: 1, limit: 20, q: null, action: null }), {});
  assert.deepEqual(buildAuditFilter({ page: 1, limit: 20, q: null, action: 'store.suspend' }), { action: 'store.suspend' });
  assert.deepEqual(buildAuditFilter({ page: 1, limit: 20, q: STORE_ID, action: null }), { $or: [{ entityId: STORE_ID }, { actorId: STORE_ID }] });
  const text = buildAuditFilter({ page: 1, limit: 20, q: 'a.b', action: null }) as any;
  assert.equal(text.action.$regex, 'a\\.b');
  const both = buildAuditFilter({ page: 1, limit: 20, q: 'sus', action: 'store.suspend' }) as any;
  assert.equal(both.$and.length, 2);
});

test('an entry is shaped with id, the actor name, and the status change', () => {
  const people = new Map([[ADMIN_ID, { name: 'Op Erator', email: 'op@example.com' }]]);
  const entry = toAuditListEntry(row, people) as any;
  assert.equal(entry.id, ENTRY_ID);
  assert.equal('_id' in entry, false);
  assert.deepEqual([entry.actor.name, entry.reason, entry.note, entry.from, entry.to], ['Op Erator', 'chargebacks', 'see ticket', 'active', 'suspended']);
  const system = toAuditListEntry({ ...row, actorId: 'system', details: undefined }, people) as any;
  assert.deepEqual([system.actor.id, system.actor.name, system.reason, system.from], ['system', null, null, null]);
});

test('action facets keep valid names only, sorted and unique', () => {
  assert.deepEqual(toActionFacets(['store.suspend', 'store.activate', 'store.suspend', '$bad', 5]), ['store.activate', 'store.suspend']);
  assert.deepEqual(toActionFacets(null), []);
});

test('the audit log needs an admin token', async () => {
  const restore = install({});
  try {
    assert.equal((await GET(await request('/api/admin/audit', null))).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await GET(await request('/api/admin/audit', seller))).status, 401);
    assert.equal(calls.find.length, 0);
  } finally {
    restore();
  }
});

test('the audit list answers the envelope with actor names and the action facets', async () => {
  const restore = install({ rows: [row], total: 45, actions: ['store.suspend', 'store.activate'] });
  try {
    const response = await GET(await request('/api/admin/audit?page=3&limit=20&action=store.suspend&q=' + STORE_ID));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.equal(body.totalDocs, 45);
    assert.equal(body.totalPages, 3);
    assert.equal(body.docs[0].id, ENTRY_ID);
    assert.equal(body.docs[0].actor.name, 'Op Erator');
    assert.deepEqual(body.facets.actions, ['store.activate', 'store.suspend']);
    assert.equal(calls.skip[0], 40);
    assert.equal(calls.find[0].$and.length, 2);
  } finally {
    restore();
  }
});

test('an invalid audit query is 422 and reads nothing', async () => {
  const restore = install({ rows: [row] });
  try {
    const response = await GET(await request('/api/admin/audit?action=%24ne'));
    assert.equal(response.status, 422);
    assert.equal(calls.find.length, 0);
  } finally {
    restore();
  }
});
