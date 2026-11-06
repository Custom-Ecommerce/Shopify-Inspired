import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SyncOutbox, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { LAST_ERROR_MAX, parseSyncQuery, toSyncEvent } from '@/lib/admin-sync';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const EVENT_ID = '65a0000000000000000000a1';
const STORE_ID = '65a000000000000000000010';
const T1 = new Date('2026-10-11T09:00:00.000Z');
const T2 = new Date('2026-10-11T09:30:00.000Z');

const OutboxModel = SyncOutbox as any;
const UserModel = User as any;

let GET: (request: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  GET = (await import('../src/app/api/admin/sync/outbox/route')).GET;
});

const calls: { find: any[]; count: any[]; findOne: any[]; skip: number[]; selects: string[] } = { find: [], count: [], findOne: [], skip: [], selects: [] };

interface Stub {
  role?: string;
  counts?: Record<string, number>;
  events?: unknown[];
  oldest?: unknown;
  lastSent?: unknown;
}

function install(stub: Stub): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    find: OutboxModel.find,
    count: OutboxModel.countDocuments,
    findOne: OutboxModel.findOne,
  };
  for (const list of Object.values(calls)) (list as unknown[]).length = 0;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: stub.role ?? 'admin' }) }) });
  OutboxModel.find = (filter: unknown) => {
    calls.find.push(filter);
    const q: any = { select: (s: string) => (calls.selects.push(s), q), sort: () => q, skip: (n: number) => (calls.skip.push(n), q), limit: () => q, lean: async () => stub.events ?? [] };
    return q;
  };
  OutboxModel.countDocuments = async (filter: any) => (calls.count.push(filter), (stub.counts ?? {})[filter.status] ?? 0);
  OutboxModel.findOne = (filter: any) => {
    calls.findOne.push(filter);
    const value = filter.status === 'pending' ? stub.oldest : stub.lastSent;
    const q: any = { sort: () => q, select: () => q, lean: async () => value ?? null };
    return q;
  };
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    OutboxModel.find = originals.find;
    OutboxModel.countDocuments = originals.count;
    OutboxModel.findOne = originals.findOne;
  };
}

async function request(path: string, token?: string | null): Promise<Request> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  return new Request('http://admin.test' + path, { headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });
}

const dead = {
  _id: EVENT_ID,
  eventId: 'evt_1',
  target: 'seller',
  entity: 'store',
  entityId: STORE_ID,
  group: 'governance',
  revision: 3,
  status: 'dead',
  attempts: 8,
  lastError: 'receiver answered 500',
  payload: { status: 'suspended', secret: 'never returned' },
  createdAt: T1,
};

test('parseSyncQuery defaults to dead letters and refuses unknown values', () => {
  assert.deepEqual(parseSyncQuery(new URLSearchParams()), { ok: true, query: { page: 1, limit: 20, status: 'dead' } });
  assert.equal((parseSyncQuery(new URLSearchParams('status=sent')) as any).query.status, 'sent');
  for (const bad of ['status=failed', 'page=0', 'limit=101']) assert.equal(parseSyncQuery(new URLSearchParams(bad)).ok, false, bad);
});

test('toSyncEvent uses id, trims a long error, and never carries the payload', () => {
  const event = toSyncEvent({ ...dead, lastError: 'e'.repeat(LAST_ERROR_MAX + 50) }) as any;
  assert.equal(event.id, EVENT_ID);
  assert.equal(event.lastError.length, LAST_ERROR_MAX);
  assert.equal('_id' in event, false);
  assert.equal('payload' in event, false);
  assert.equal(event.sentAt, null);
  assert.equal(toSyncEvent({ ...dead, lastError: '' }).lastError, null);
});

test('the outbox needs an admin token', async () => {
  const restore = install({});
  try {
    assert.equal((await GET(await request('/api/admin/sync/outbox', null))).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await GET(await request('/api/admin/sync/outbox', seller))).status, 401);
    assert.equal(calls.count.length, 0);
  } finally {
    restore();
  }
});

test('the outbox answers the counts, the ages, and the dead letters by default', async () => {
  const restore = install({ counts: { pending: 4, sent: 120, dead: 21 }, events: [dead], oldest: { createdAt: T1 }, lastSent: { sentAt: T2 } });
  try {
    const response = await GET(await request('/api/admin/sync/outbox?page=2&limit=20'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.deepEqual(body.counts, { pending: 4, sent: 120, dead: 21 });
    assert.equal(body.status, 'dead');
    assert.equal(body.oldestPendingAt, T1.toISOString());
    assert.equal(body.lastSentAt, T2.toISOString());
    assert.equal(body.events.totalDocs, 21);
    assert.equal(body.events.totalPages, 2);
    assert.equal(body.events.docs[0].id, EVENT_ID);
    assert.equal('payload' in body.events.docs[0], false);
    assert.deepEqual(calls.find[0], { status: 'dead' });
    assert.equal(calls.skip[0], 20);
    assert.equal(calls.selects[0].includes('payload'), false);
  } finally {
    restore();
  }
});

test('another status can be listed, and the ages are null when nothing is pending or sent', async () => {
  const restore = install({ counts: { pending: 0, sent: 0, dead: 0 }, events: [] });
  try {
    const body = (await (await GET(await request('/api/admin/sync/outbox?status=pending'))).json()) as any;
    assert.equal(body.status, 'pending');
    assert.equal(body.oldestPendingAt, null);
    assert.equal(body.lastSentAt, null);
    assert.equal(body.events.totalPages, 0);
    assert.deepEqual(calls.find[0], { status: 'pending' });
  } finally {
    restore();
  }
});

test('an invalid outbox query is 422 and reads nothing', async () => {
  const restore = install({});
  try {
    const response = await GET(await request('/api/admin/sync/outbox?status=failed'));
    assert.equal(response.status, 422);
    assert.equal(calls.find.length, 0);
    assert.equal(calls.count.length, 0);
  } finally {
    restore();
  }
});
