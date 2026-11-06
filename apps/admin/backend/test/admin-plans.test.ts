import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SubscriptionPlanModel, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { buildPlanFilter, parsePlanQuery, toPlanRow, toTierCounts } from '@/lib/admin-plans';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const PLAN_ID = '65a0000000000000000000c1';
const T1 = new Date('2026-10-01T09:00:00.000Z');
const T2 = new Date('2026-10-05T09:00:00.000Z');

const PlanModel = SubscriptionPlanModel as any;
const UserModel = User as any;

let GET: (request: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  GET = (await import('../src/app/api/admin/subscription-plans/route')).GET;
});

const calls = { find: [] as any[], count: [] as any[], skip: [] as number[] };

interface Stub {
  plans?: unknown[];
  total?: number;
  tiers?: Record<string, number>;
}

function install(stub: Stub): () => void {
  const originals = { connect: (mongoose as any).connect, userFindById: UserModel.findById, find: PlanModel.find, count: PlanModel.countDocuments };
  for (const list of Object.values(calls)) (list as unknown[]).length = 0;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin' }) }) });
  PlanModel.find = (filter: unknown) => {
    calls.find.push(filter);
    const q: any = { sort: () => q, skip: (n: number) => (calls.skip.push(n), q), limit: () => q, lean: async () => stub.plans ?? [] };
    return q;
  };
  PlanModel.countDocuments = async (filter: any) => (calls.count.push(filter), (stub.tiers ?? {})[filter.tier] ?? stub.total ?? (stub.plans ?? []).length);
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    PlanModel.find = originals.find;
    PlanModel.countDocuments = originals.count;
  };
}

async function request(path: string, token?: string | null): Promise<Request> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  return new Request('http://admin.test' + path, { headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });
}

const plan = { _id: PLAN_ID, name: 'Pro monthly', tier: 'pro', stripePriceId: 'price_123', createdAt: T1, updatedAt: T2 };

test('parsePlanQuery reads page, limit, q, and tier, and refuses anything malformed', () => {
  assert.deepEqual(parsePlanQuery(new URLSearchParams()), { ok: true, query: { page: 1, limit: 20, q: null, tier: null } });
  assert.deepEqual(parsePlanQuery(new URLSearchParams('tier=premium&q=%20pro%20&page=2')), { ok: true, query: { page: 2, limit: 20, q: 'pro', tier: 'premium' } });
  for (const bad of ['tier=gold', 'page=0', 'limit=101', 'q=' + 'a'.repeat(101)]) assert.equal(parsePlanQuery(new URLSearchParams(bad)).ok, false, bad);
});

test('buildPlanFilter matches the name literally and the tier exactly', () => {
  const base = { page: 1, limit: 20, q: null, tier: null };
  assert.deepEqual(buildPlanFilter(base), {});
  assert.deepEqual(buildPlanFilter({ ...base, tier: 'basic' }), { tier: 'basic' });
  assert.deepEqual(buildPlanFilter({ ...base, q: 'a.b' }), { name: { $regex: 'a\\.b', $options: 'i' } });
});

test('toPlanRow uses id and ISO dates, and toTierCounts zeroes anything unusable', () => {
  const row = toPlanRow(plan) as any;
  assert.equal(row.id, PLAN_ID);
  assert.equal('_id' in row, false);
  assert.equal(row.createdAt, T1.toISOString());
  assert.equal(row.updatedAt, T2.toISOString());
  assert.equal(toPlanRow({ ...plan, updatedAt: undefined }).updatedAt, T1.toISOString());
  assert.deepEqual(toTierCounts([2, 1, 0]), { basic: 2, pro: 1, premium: 0 });
  assert.deepEqual(toTierCounts([undefined, -1, 'x']), { basic: 0, pro: 0, premium: 0 });
});

test('the plan list needs an admin token and reads nothing without one', async () => {
  const restore = install({});
  try {
    assert.equal((await GET(await request('/api/admin/subscription-plans', null))).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await GET(await request('/api/admin/subscription-plans', seller))).status, 401);
    assert.equal(calls.find.length, 0);
  } finally {
    restore();
  }
});

test('the plan list answers a page with the tier counts', async () => {
  const restore = install({ plans: [plan], total: 1, tiers: { basic: 2, pro: 1, premium: 0 } });
  try {
    const response = await GET(await request('/api/admin/subscription-plans?page=1'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.equal(body.docs[0].id, PLAN_ID);
    assert.equal(body.docs[0].stripePriceId, 'price_123');
    assert.equal(body.totalDocs, 1);
    assert.deepEqual(body.counts, { basic: 2, pro: 1, premium: 0 });
    assert.deepEqual(calls.find[0], {});
  } finally {
    restore();
  }
});

test('the plan list filters by tier and name, and an invalid query is 422 and reads nothing', async () => {
  const restore = install({ plans: [], total: 0 });
  try {
    const response = await GET(await request('/api/admin/subscription-plans?tier=pro&q=monthly'));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.find[0], { tier: 'pro', name: { $regex: 'monthly', $options: 'i' } });
    const found = calls.find.length;
    assert.equal((await GET(await request('/api/admin/subscription-plans?tier=gold'))).status, 422);
    assert.equal(calls.find.length, found);
  } finally {
    restore();
  }
});
