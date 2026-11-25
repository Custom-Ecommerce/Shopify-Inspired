import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, SubscriptionPlanModel, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import {
  PROTECTED_PLAN_KEYS,
  buildArchiveUpdate,
  buildPlanDocument,
  buildPlanUpdate,
  changedPlanFields,
  planRevisionFilter,
  planRevisionOf,
  toPlanRow,
} from '@/lib/admin-plans';

// Sprint 6 EP-14.US01 (D-118): create, update and archive a subscription plan. The model is stubbed in memory; no database.

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const PLAN_ID = '65a0000000000000000000c1';
const FREE_ID = '65a0000000000000000000c2';
const T1 = new Date('2026-10-01T09:00:00.000Z');
const PlanModel = SubscriptionPlanModel as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;

const limits = { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true };
const growth = { _id: PLAN_ID, key: 'growth', name: 'Growth', priceRs: 2500, interval: 'month', limits, features: ['Premium themes'], sortOrder: 2, isActive: true, archivedAt: null, revision: 2, createdAt: T1, updatedAt: T1 };
const free = { _id: FREE_ID, key: 'free', name: 'Free', priceRs: 0, interval: 'month', limits: { ...limits, stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false }, features: [], sortOrder: 1, isActive: true, archivedAt: null, revision: 0, createdAt: T1, updatedAt: T1 };

let plans: Record<string, Record<string, any>>;
let created: Array<Record<string, any>>;
let updates: Array<{ filter: any; update: any }>;
let audits: Array<Record<string, any>>;
let userRole: string;
let createError: unknown;
let casFails: boolean;
let restore: () => void = () => {};
let routes: {
  list: { POST: (r: Request) => Promise<Response> };
  one: { PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> };
  archive: { POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> };
};

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  routes = {
    list: await import('../src/app/api/admin/subscription-plans/route'),
    one: await import('../src/app/api/admin/subscription-plans/[id]/route'),
    archive: await import('../src/app/api/admin/subscription-plans/[id]/archive/route'),
  } as never;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  plans = { [PLAN_ID]: { ...growth }, [FREE_ID]: { ...free } };
  created = [];
  updates = [];
  audits = [];
  userRole = 'admin';
  createError = null;
  casFails = false;
  const saved = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    findOne: PlanModel.findOne,
    findById: PlanModel.findById,
    findOneAndUpdate: PlanModel.findOneAndUpdate,
    create: PlanModel.create,
    deleteOne: PlanModel.deleteOne,
    audit: AuditModel.create,
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => chain(() => ({ role: userRole }));
  PlanModel.findOne = (filter: any) => chain(() => Object.values(plans).find((row) => row.key === filter.key) ?? null);
  PlanModel.findById = (id: unknown) => chain(() => (plans[String(id)] ? { ...plans[String(id)] } : null));
  PlanModel.findOneAndUpdate = (filter: any, update: any) => {
    updates.push({ filter, update });
    return chain(() => {
      const row = plans[String(filter._id)];
      if (casFails || !row) return null;
      const current = typeof row.revision === 'number' ? row.revision : 0;
      const wanted = filter.revision;
      const matches = typeof wanted === 'object' ? wanted.$in.includes(current) : wanted === current;
      if (!matches) return null;
      Object.assign(row, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) delete row[key];
      row.revision = current + (update.$inc?.revision ?? 0);
      row.updatedAt = new Date('2026-11-20T10:00:00.000Z');
      return { ...row };
    });
  };
  PlanModel.create = async (doc: Record<string, any>) => {
    if (createError) throw createError;
    created.push(doc);
    const row = { _id: '65a0000000000000000000d1', createdAt: T1, updatedAt: T1, ...doc };
    plans[row._id] = row;
    return row;
  };
  // Nothing may delete a plan: this fails the test if a route ever tries.
  PlanModel.deleteOne = () => {
    throw new Error('a plan must never be deleted');
  };
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findById = saved.userFindById;
    PlanModel.findOne = saved.findOne;
    PlanModel.findById = saved.findById;
    PlanModel.findOneAndUpdate = saved.findOneAndUpdate;
    PlanModel.create = saved.create;
    PlanModel.deleteOne = saved.deleteOne;
    AuditModel.create = saved.audit;
  };
});

afterEach(() => restore());

const token = (role = 'admin') => signSession({ sub: ADMIN_ID, role }, SECRET, ADMIN_AUDIENCE);
const send = async (method: string, path: string, body?: unknown, bearer?: string | null) =>
  new Request('http://admin.test' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(bearer === null ? {} : { authorization: 'Bearer ' + (bearer ?? (await token())) }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = async (body: unknown, bearer?: string | null) => routes.list.POST(await send('POST', '/api/admin/subscription-plans', body, bearer));
const patch = async (id: string, body: unknown, bearer?: string | null) => routes.one.PATCH(await send('PATCH', '/api/admin/subscription-plans/' + id, body, bearer), ctx(id));
const archive = async (id: string, body: unknown, bearer?: string | null) => routes.archive.POST(await send('POST', '/api/admin/subscription-plans/' + id + '/archive', body, bearer), ctx(id));

const newPlan = { key: 'scale', name: 'Scale', priceRs: 5000, limits: { ...limits, stores: 10 }, features: ['Priority support'], sortOrder: 3, reason: 'A bigger plan' };

// ------------------------------------------------------------------------------------------------------------------ pure helpers

test('the plan row reads the new fields, and an old plan (name, price id, tier) has null key, price and limits', () => {
  const row = toPlanRow(growth);
  assert.deepEqual([row.key, row.priceRs, row.revision, row.isActive, row.tier, row.stripePriceId], ['growth', 2500, 2, true, null, null]);
  assert.deepEqual(row.limits, limits);
  const old = toPlanRow({ _id: PLAN_ID, name: 'Pro monthly', tier: 'pro', stripePriceId: 'price_123', createdAt: T1 });
  assert.deepEqual([old.key, old.priceRs, old.limits, old.tier, old.stripePriceId, old.revision, old.isActive, old.features], [null, null, null, 'pro', 'price_123', 0, true, []]);
});

test('the revision filter matches a plan with no revision as 0, and the update advances the revision by one', () => {
  assert.equal(planRevisionOf({}), 0);
  assert.equal(planRevisionOf({ revision: 4 }), 4);
  assert.equal(planRevisionOf({ revision: -1 }), 0);
  assert.deepEqual(planRevisionFilter(PLAN_ID, 0), { _id: PLAN_ID, revision: { $in: [0, null] } });
  assert.deepEqual(planRevisionFilter(PLAN_ID, 3), { _id: PLAN_ID, revision: 3 });
  assert.deepEqual(buildPlanUpdate({ priceRs: 3000 }), { $inc: { revision: 1 }, $set: { priceRs: 3000 } });
  assert.deepEqual(buildPlanUpdate({ stripePriceId: null, name: 'X' }), { $inc: { revision: 1 }, $set: { name: 'X' }, $unset: { stripePriceId: 1 } });
  assert.deepEqual(buildPlanUpdate({ isActive: true }), { $inc: { revision: 1 }, $set: { isActive: true, archivedAt: null } });
  assert.deepEqual(changedPlanFields({ name: 'X', sortOrder: 0 }), ['name', 'sortOrder']);
  const archived = buildArchiveUpdate(T1);
  assert.deepEqual(archived, { $set: { isActive: false, archivedAt: T1 }, $inc: { revision: 1 } });
});

test('a new plan document is active, at revision 0, not archived, and has a Stripe price only when one was given', () => {
  const doc = buildPlanDocument({ key: 'scale', name: 'Scale', priceRs: 5000, limits, features: [], sortOrder: 0 });
  assert.deepEqual([doc.isActive, doc.revision, doc.archivedAt, doc.interval], [true, 0, null, 'month']);
  assert.equal('stripePriceId' in doc, false);
  assert.equal(buildPlanDocument({ key: 'scale', name: 'Scale', priceRs: 0, limits, features: [], sortOrder: 0, stripePriceId: 'price_1ABC' }).stripePriceId, 'price_1ABC');
  assert.deepEqual([...PROTECTED_PLAN_KEYS], ['free']);
});

// ----------------------------------------------------------------------------------------------------------------------- create

test('POST creates a plan: 201, the document as sent, revision 0, and an audit entry with the reason', async () => {
  const response = await post(newPlan);
  assert.equal(response.status, 201);
  const body = (await response.json()) as any;
  assert.deepEqual([body.plan.key, body.plan.priceRs, body.plan.revision, body.plan.isActive], ['scale', 5000, 0, true]);
  assert.equal(created.length, 1);
  assert.deepEqual([created[0]!.key, created[0]!.priceRs, created[0]!.revision, created[0]!.isActive], ['scale', 5000, 0, true]);
  assert.equal('reason' in created[0]!, false, 'the reason goes to the audit entry, not the plan');
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'plan.create');
  assert.equal(audits[0]!.actorId, ADMIN_ID);
  assert.equal(audits[0]!.details.reason, 'A bigger plan');
  assert.equal(audits[0]!.details.after.priceRs, 5000);
});

test('POST: a price of 0 is a plan, a fractional price is a 400 naming the field, and nothing is created', async () => {
  assert.equal((await post({ ...newPlan, key: 'tiny', priceRs: 0 })).status, 201);
  created.length = 0;
  const response = await post({ ...newPlan, priceRs: 2500.5 });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { field: string }).field, 'priceRs');
  assert.equal(created.length, 0);
});

test('POST: every bad field is a 400 that names it: key, name, limits, features, stripePriceId, reason, an unknown field', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ key: 'Bad Key' }, 'key'],
    [{ name: 'x' }, 'name'],
    [{ limits: { ...limits, stores: 0 } }, 'limits.stores'],
    [{ limits: { ...limits, products: -1 } }, 'limits.products'],
    [{ limits: { stores: 1 } }, 'limits.products'],
    [{ features: ['<b>x</b>'] }, 'features.0'],
    [{ stripePriceId: 'prod_9' }, 'stripePriceId'],
    [{ reason: 'no' }, 'reason'],
    [{ sortOrder: 1.5 }, 'sortOrder'],
    [{ revision: 3 }, 'revision'],
    [{ isActive: false }, 'isActive'],
  ];
  for (const [change, field] of cases) {
    const response = await post({ ...newPlan, ...change });
    assert.equal(response.status, 400, JSON.stringify(change));
    assert.equal(((await response.json()) as { field: string }).field, field, JSON.stringify(change));
  }
  const { reason: _omit, ...noReason } = newPlan;
  void _omit;
  assert.equal(((await (await post(noReason)).json()) as { field: string }).field, 'reason');
  assert.equal((await post('not json')).status, 400);
  assert.equal(created.length, 0);
  assert.equal(audits.length, 0);
});

test('POST: a key that already exists is a 409 PLAN_KEY_TAKEN, whether found first or lost in a race', async () => {
  const taken = await post({ ...newPlan, key: 'growth' });
  assert.equal(taken.status, 409);
  const body = (await taken.json()) as { code: string; field: string };
  assert.deepEqual([body.code, body.field], ['PLAN_KEY_TAKEN', 'key']);
  assert.equal(created.length, 0);

  createError = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
  const raced = await post(newPlan);
  assert.equal(raced.status, 409);
  assert.equal(((await raced.json()) as { code: string }).code, 'PLAN_KEY_TAKEN');
  assert.equal(audits.length, 0);
});

test('POST: no session, a seller session and a wrong audience are refused before anything is read or written', async () => {
  assert.equal((await post(newPlan, null)).status, 401);
  userRole = 'seller';
  assert.equal((await post(newPlan)).status, 401);
  userRole = 'admin';
  const wrong = await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, 'seller-backend');
  assert.equal((await post(newPlan, wrong)).status, 401);
  assert.equal(created.length + audits.length, 0);
});

// ------------------------------------------------------------------------------------------------------------------------ update

test('PATCH changes the fields sent, only if the revision is the one seen, advances it, and audits before and after with the reason', async () => {
  const response = await patch(PLAN_ID, { revision: 2, priceRs: 3000, name: 'Growth Plus', reason: 'Price rise' });
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.deepEqual([body.plan.priceRs, body.plan.name, body.plan.revision, body.plan.key], [3000, 'Growth Plus', 3, 'growth']);
  assert.deepEqual(updates[0], { filter: { _id: PLAN_ID, revision: 2 }, update: { $inc: { revision: 1 }, $set: { name: 'Growth Plus', priceRs: 3000 } } });
  assert.equal(audits[0]!.action, 'plan.update');
  assert.deepEqual(audits[0]!.details.changed, ['name', 'priceRs']);
  assert.equal(audits[0]!.details.reason, 'Price rise');
  assert.equal(audits[0]!.details.before.priceRs, 2500);
  assert.equal(audits[0]!.details.after.priceRs, 3000);
});

test('PATCH: limits are replaced as a whole, with null staying unlimited; a cleared Stripe price is removed', async () => {
  const response = await patch(PLAN_ID, { revision: 2, limits: { ...limits, products: 500, apiKeys: null }, stripePriceId: null, reason: 'New limits' });
  assert.equal(response.status, 200);
  assert.deepEqual(updates[0]!.update.$set.limits, { ...limits, products: 500, apiKeys: null });
  assert.deepEqual(updates[0]!.update.$unset, { stripePriceId: 1 });
});

test('PATCH: a stale revision is a 409 and nothing is written; a write lost in a race is a 409 too', async () => {
  const stale = await patch(PLAN_ID, { revision: 1, priceRs: 3000, reason: 'Stale edit' });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as { code: string }).code, 'PLAN_REVISION_CHANGED');
  assert.equal(updates.length, 0);
  casFails = true;
  assert.equal((await patch(PLAN_ID, { revision: 2, priceRs: 3000, reason: 'Racing edit' })).status, 409);
  assert.equal(audits.length, 0);
  assert.equal(plans[PLAN_ID]!.priceRs, 2500);
});

test('PATCH: two edits from the same revision leave one: the second is a 409', async () => {
  assert.equal((await patch(PLAN_ID, { revision: 2, priceRs: 3000, reason: 'First edit' })).status, 200);
  assert.equal((await patch(PLAN_ID, { revision: 2, priceRs: 3500, reason: 'Second edit' })).status, 409);
  assert.equal(plans[PLAN_ID]!.priceRs, 3000);
});

test('PATCH: validation names the field: the key cannot change, a fraction, no change at all, no reason, no revision', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ revision: 2, key: 'other', reason: 'Rekey' }, 'key'],
    [{ revision: 2, priceRs: 1.5, reason: 'Fraction' }, 'priceRs'],
    [{ revision: 2, reason: 'Nothing changes' }, 'name'],
    [{ revision: 2, name: 'Growth Plus' }, 'reason'],
    [{ name: 'Growth Plus', reason: 'No revision' }, 'revision'],
    [{ revision: 2, isActive: false, reason: 'Use archive instead' }, 'isActive'],
  ];
  for (const [body, field] of cases) {
    const response = await patch(PLAN_ID, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(((await response.json()) as { field: string }).field, field, JSON.stringify(body));
  }
  assert.equal(updates.length, 0);
});

test('PATCH: an unknown plan and a bad id are 404, and a seller session is refused', async () => {
  assert.equal((await patch('65a0000000000000000000ff', { revision: 0, name: 'Ghost', reason: 'Not there' })).status, 404);
  assert.equal((await patch('nope', { revision: 0, name: 'Ghost', reason: 'Not there' })).status, 404);
  userRole = 'seller';
  assert.equal((await patch(PLAN_ID, { revision: 2, name: 'Mine', reason: 'Not an admin' })).status, 401);
  assert.equal((await patch(PLAN_ID, { revision: 2, name: 'Mine', reason: 'Not an admin' }, null)).status, 401);
  assert.equal(updates.length, 0);
});

test('PATCH: bringing an archived plan back clears archivedAt', async () => {
  plans[PLAN_ID] = { ...growth, isActive: false, archivedAt: T1, revision: 3 };
  const response = await patch(PLAN_ID, { revision: 3, isActive: true, reason: 'Back on sale' });
  assert.equal(response.status, 200);
  assert.deepEqual(updates[0]!.update.$set, { isActive: true, archivedAt: null });
  assert.equal(((await response.json()) as any).plan.archivedAt, null);
});

test('PATCH: an old plan with no revision is edited at revision 0', async () => {
  plans[PLAN_ID] = { _id: PLAN_ID, name: 'Pro monthly', tier: 'pro', stripePriceId: 'price_123', createdAt: T1, updatedAt: T1 };
  const response = await patch(PLAN_ID, { revision: 0, name: 'Pro (renamed)', reason: 'Tidy up' });
  assert.equal(response.status, 200);
  assert.deepEqual(updates[0]!.filter, { _id: PLAN_ID, revision: { $in: [0, null] } });
  const plan = ((await response.json()) as any).plan;
  assert.deepEqual([plan.revision, plan.tier, plan.key, plan.limits], [1, 'pro', null, null]);
});

// ----------------------------------------------------------------------------------------------------------------------- archive

test('archive needs a reason, takes the plan off sale without deleting it, advances the revision and audits', async () => {
  const response = await archive(PLAN_ID, { revision: 2, reason: 'Retired for a new plan' });
  assert.equal(response.status, 200);
  const plan = ((await response.json()) as any).plan;
  assert.deepEqual([plan.isActive, plan.revision, typeof plan.archivedAt], [false, 3, 'string']);
  assert.equal(plans[PLAN_ID]!.isActive, false, 'the plan is still there');
  assert.equal(audits[0]!.action, 'plan.archive');
  assert.equal(audits[0]!.details.reason, 'Retired for a new plan');
  assert.equal(audits[0]!.details.before.isActive, true);
  assert.equal(audits[0]!.details.after.isActive, false);
});

test('archive: no reason, a short reason and a missing revision are 400 with the field', async () => {
  for (const [body, field] of [
    [{ revision: 2 }, 'reason'],
    [{ revision: 2, reason: 'no' }, 'reason'],
    [{ reason: 'Retired' }, 'revision'],
    [{ revision: 2, reason: 'Retired', hard: true }, 'hard'],
  ] as const) {
    const response = await archive(PLAN_ID, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(((await response.json()) as { field: string }).field, field, JSON.stringify(body));
  }
  assert.equal(updates.length, 0);
});

test('archive: the Free plan is protected, an archived plan cannot be archived again, a stale revision is a 409', async () => {
  const protectedPlan = await archive(FREE_ID, { revision: 0, reason: 'Trying to remove Free' });
  assert.equal(protectedPlan.status, 409);
  assert.equal(((await protectedPlan.json()) as { code: string }).code, 'PLAN_PROTECTED');

  plans[PLAN_ID] = { ...growth, isActive: false, archivedAt: T1 };
  const again = await archive(PLAN_ID, { revision: 2, reason: 'Archive twice' });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { code: string }).code, 'PLAN_ARCHIVED');

  plans[PLAN_ID] = { ...growth };
  assert.equal((await archive(PLAN_ID, { revision: 1, reason: 'Stale archive' })).status, 409);
  assert.equal(updates.length, 0);
  assert.equal(audits.length, 0);
});

test('archive: an unknown plan and a bad id are 404, a seller session is refused, and no route ever deletes a plan', async () => {
  assert.equal((await archive('65a0000000000000000000ff', { revision: 0, reason: 'Not there' })).status, 404);
  assert.equal((await archive('nope', { revision: 0, reason: 'Not there' })).status, 404);
  userRole = 'seller';
  assert.equal((await archive(PLAN_ID, { revision: 2, reason: 'Not an admin' })).status, 401);
  assert.equal(updates.length, 0);
  const files = ['../src/app/api/admin/subscription-plans/route', '../src/app/api/admin/subscription-plans/[id]/route', '../src/app/api/admin/subscription-plans/[id]/archive/route'];
  for (const file of files) assert.equal('DELETE' in (await import(file)), false, file);
});

test('a failed audit entry does not undo a plan change that was made', async () => {
  AuditModel.create = async () => {
    throw new Error('audit down');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await patch(PLAN_ID, { revision: 2, priceRs: 2600, reason: 'Audit is down' })).status, 200);
    assert.equal(plans[PLAN_ID]!.priceRs, 2600);
  } finally {
    console.error = quiet;
  }
});
