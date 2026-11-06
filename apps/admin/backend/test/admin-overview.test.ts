import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { CommissionLedgerModel, Store, SyncOutbox, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { ADMIN_OVERVIEW_NEW_SELLER_DAYS, adminOverviewSchema } from '../../../../packages/contracts/src/admin-overview';
import { NEW_SELLER_WINDOW_DAYS, OVERVIEW_LEDGER_FIELDS, newSellerSince, toOutboxHealth, toOverview, toSellerCounts, toStoreCounts } from '@/lib/admin-overview';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const T1 = new Date('2026-10-11T09:00:00.000Z');
const T2 = new Date('2026-10-11T09:30:00.000Z');

const UserModel = User as any;
const StoreModel = Store as any;
const LedgerModel = CommissionLedgerModel as any;
const OutboxModel = SyncOutbox as any;

let route: Record<string, ((request: Request) => Promise<Response>) | undefined>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  route = (await import('../src/app/api/admin/overview/route')) as any;
});

interface Stub {
  role?: string;
  storeGroups?: unknown;
  sellerTotal?: number;
  sellerRecent?: number;
  ledgerGroups?: unknown;
  counts?: Record<string, number>;
  oldest?: unknown;
  lastSent?: unknown;
}

const calls = {
  userCounts: [] as any[],
  storePipelines: [] as any[],
  ledgerPipelines: [] as any[],
  outboxCounts: [] as any[],
  outboxFinds: [] as any[],
  sorts: [] as any[],
  selects: [] as string[],
};

function install(stub: Stub = {}): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    userCount: UserModel.countDocuments,
    storeAggregate: StoreModel.aggregate,
    ledgerAggregate: LedgerModel.aggregate,
    outboxCount: OutboxModel.countDocuments,
    outboxFindOne: OutboxModel.findOne,
  };
  for (const list of Object.values(calls)) (list as unknown[]).length = 0;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: stub.role ?? 'admin' }) }) });
  UserModel.countDocuments = async (filter: any) => (calls.userCounts.push(filter), filter.createdAt ? (stub.sellerRecent ?? 0) : (stub.sellerTotal ?? 0));
  StoreModel.aggregate = async (pipeline: unknown) => (calls.storePipelines.push(pipeline), stub.storeGroups ?? []);
  LedgerModel.aggregate = async (pipeline: unknown) => (calls.ledgerPipelines.push(pipeline), stub.ledgerGroups ?? []);
  OutboxModel.countDocuments = async (filter: any) => (calls.outboxCounts.push(filter), (stub.counts ?? {})[filter.status] ?? 0);
  OutboxModel.findOne = (filter: any) => {
    calls.outboxFinds.push(filter);
    const value = filter.status === 'pending' ? stub.oldest : stub.lastSent;
    const q: any = {
      sort: (sort: unknown) => (calls.sorts.push(sort), q),
      select: (select: string) => (calls.selects.push(select), q),
      lean: async () => value ?? null,
    };
    return q;
  };
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    UserModel.countDocuments = originals.userCount;
    StoreModel.aggregate = originals.storeAggregate;
    LedgerModel.aggregate = originals.ledgerAggregate;
    OutboxModel.countDocuments = originals.outboxCount;
    OutboxModel.findOne = originals.outboxFindOne;
  };
}

async function request(bearer?: string | null): Promise<Request> {
  const value = bearer === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : bearer;
  return new Request('http://admin.test/api/admin/overview', { headers: value ? { authorization: 'Bearer ' + value } : {} });
}

const FULL: Stub = {
  storeGroups: [
    { _id: 'active', count: 5 },
    { _id: 'pending', count: 2 },
    { _id: 'suspended', count: 1 },
    { _id: 'mystery', count: 9 },
    { _id: null, count: 4 },
  ],
  sellerTotal: 7,
  sellerRecent: 2,
  ledgerGroups: [
    { _id: 'pending', count: 3, orderAmount: 120000, commissionAmount: 4800 },
    { _id: 'settled', count: 10, orderAmount: 900000, commissionAmount: 36000 },
    { _id: 'refunded', count: 1, orderAmount: 5, commissionAmount: 5 },
  ],
  counts: { pending: 1, sent: 10, dead: 2 },
  oldest: { createdAt: T1 },
  lastSent: { sentAt: T2 },
};

test('the backend window and the ledger fields match the contract and the policy', () => {
  assert.equal(NEW_SELLER_WINDOW_DAYS, ADMIN_OVERVIEW_NEW_SELLER_DAYS);
  assert.deepEqual([...OVERVIEW_LEDGER_FIELDS], ['status', 'orderAmount', 'commissionAmount']);
});

test('newSellerSince is exactly the window before now', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  assert.equal(newSellerSince(now).toISOString(), '2026-10-01T12:00:00.000Z');
});

test('toStoreCounts reads the four statuses, zeroes a missing one, and ignores any other group', () => {
  assert.deepEqual(toStoreCounts([{ _id: 'active', count: 5 }, { _id: 'pending', count: 2 }, { _id: 'weird', count: 9 }, { _id: null, count: 3 }]), {
    total: 7,
    byStatus: { pending: 2, active: 5, suspended: 0, archived: 0 },
  });
  assert.deepEqual(toStoreCounts(undefined), { total: 0, byStatus: { pending: 0, active: 0, suspended: 0, archived: 0 } });
  assert.deepEqual(toStoreCounts([null, 'x', { _id: 'active', count: -3 }, { _id: 'archived', count: 2.9 }]), {
    total: 2,
    byStatus: { pending: 0, active: 0, suspended: 0, archived: 2 },
  });
});

test('toSellerCounts never reports more new sellers than sellers, and a bad number is zero', () => {
  assert.deepEqual(toSellerCounts(7, 2), { total: 7, newInWindow: 2, windowDays: 30 });
  assert.deepEqual(toSellerCounts(3, 9), { total: 3, newInWindow: 3, windowDays: 30 });
  assert.deepEqual(toSellerCounts('7', undefined), { total: 0, newInWindow: 0, windowDays: 30 });
});

test('toOutboxHealth reads counts in pending, sent, dead order and the two times, and nulls a missing time', () => {
  assert.deepEqual(toOutboxHealth([1, 10, 2], { createdAt: T1 }, { sentAt: T2 }), {
    counts: { pending: 1, sent: 10, dead: 2 },
    oldestPendingAt: T1.toISOString(),
    lastSentAt: T2.toISOString(),
  });
  assert.deepEqual(toOutboxHealth([], null, undefined), { counts: { pending: 0, sent: 0, dead: 0 }, oldestPendingAt: null, lastSentAt: null });
});

test('toOverview builds the contract shape from the parts', () => {
  const overview = toOverview(
    { storeGroups: [], sellerTotal: 0, sellerRecent: 0, ledgerGroups: [], outboxCounts: [0, 0, 0], oldestPending: null, lastSent: null },
    T1,
  );
  assert.equal(adminOverviewSchema.safeParse(overview).success, true);
  assert.equal(overview.generatedAt, T1.toISOString());
  assert.deepEqual(overview.ledger.pending, { count: 0, orderAmount: 0, commissionAmount: 0 });
});

test('the route answers the headline numbers in the contract shape, with no caching', async () => {
  const restore = install(FULL);
  try {
    const response = await route.GET!(await request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.equal(adminOverviewSchema.safeParse(body).success, true);
    assert.deepEqual(body.stores, { total: 8, byStatus: { pending: 2, active: 5, suspended: 1, archived: 0 } });
    assert.deepEqual(body.sellers, { total: 7, newInWindow: 2, windowDays: 30 });
    assert.deepEqual(body.ledger.pending, { count: 3, orderAmount: 120000, commissionAmount: 4800 });
    assert.deepEqual(body.ledger.settled, { count: 10, orderAmount: 900000, commissionAmount: 36000 });
    assert.deepEqual(body.outbox, { counts: { pending: 1, sent: 10, dead: 2 }, oldestPendingAt: T1.toISOString(), lastSentAt: T2.toISOString() });
    assert.ok(!Number.isNaN(Date.parse(body.generatedAt)));
  } finally {
    restore();
  }
});

test('the route answers only the numbers: no id, name, email, or payload key', async () => {
  const restore = install({ ...FULL, oldest: { _id: 'e1', createdAt: T1, payload: { secret: 1 } }, lastSent: { _id: 'e2', sentAt: T2, payload: { secret: 2 } } });
  try {
    const text = await (await route.GET!(await request())).text();
    assert.deepEqual(Object.keys(JSON.parse(text)), ['stores', 'sellers', 'ledger', 'outbox', 'generatedAt']);
    assert.doesNotMatch(text, /secret|payload|_id|email/);
  } finally {
    restore();
  }
});

test('the route counts sellers by role, the new ones by the window, and reads only the outbox times', async () => {
  const restore = install(FULL);
  try {
    const before = Date.now();
    await route.GET!(await request());
    const after = Date.now();
    assert.equal(calls.userCounts.length, 2);
    assert.deepEqual(calls.userCounts[0], { role: 'seller' });
    const recent = calls.userCounts.find((filter) => filter.createdAt);
    assert.equal(recent.role, 'seller');
    const since = (recent.createdAt.$gte as Date).getTime();
    const window = NEW_SELLER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    assert.ok(since >= before - window && since <= after - window);
    assert.deepEqual(calls.outboxCounts, [{ status: 'pending' }, { status: 'sent' }, { status: 'dead' }]);
    assert.deepEqual(calls.outboxFinds, [{ status: 'pending' }, { status: 'sent' }]);
    assert.deepEqual(calls.sorts, [{ createdAt: 1 }, { sentAt: -1 }]);
    assert.deepEqual(calls.selects, ['createdAt', 'sentAt']);
    assert.deepEqual(calls.storePipelines[0], [{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    assert.equal(calls.ledgerPipelines[0][0].$group._id, '$status');
  } finally {
    restore();
  }
});

test('an empty platform answers zeros and null times, and still passes the contract', async () => {
  const restore = install();
  try {
    const response = await route.GET!(await request());
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(adminOverviewSchema.safeParse(body).success, true);
    assert.equal(body.stores.total, 0);
    assert.equal(body.sellers.total, 0);
    assert.equal(body.ledger.settled.count, 0);
    assert.equal(body.outbox.oldestPendingAt, null);
    assert.equal(body.outbox.lastSentAt, null);
  } finally {
    restore();
  }
});

test('no token, a seller-audience token, and a demoted operator are all refused with 401', async () => {
  const restore = install();
  try {
    assert.equal((await route.GET!(await request(null))).status, 401);
    const sellerToken = await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, 'seller-backend');
    assert.equal((await route.GET!(await request(sellerToken))).status, 401);
  } finally {
    restore();
  }
  const demoted = install({ role: 'seller' });
  try {
    assert.equal((await route.GET!(await request())).status, 401);
    assert.equal(calls.storePipelines.length, 0);
    assert.equal(calls.userCounts.length, 0);
  } finally {
    demoted();
  }
});

test('the overview is read only: the route exports GET and nothing that writes', () => {
  assert.equal(typeof route.GET, 'function');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(route[method], undefined, method);
});
