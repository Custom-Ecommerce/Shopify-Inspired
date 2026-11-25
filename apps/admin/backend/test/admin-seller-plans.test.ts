import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE, AdminHttpError } from '@/lib/admin-auth';
import { SELLER_PLANS_MAX, parseSellerIds, sellerPlanSteps } from '@/lib/admin-seller-plans';

// Sprint 6 EP-14.US02.T08 (D-118): the plan column of the sellers page, read in the seller database through a signed call (D-093 pattern). The seller
// backend call is replaced; the User model is stubbed. No database, no network.

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000003';
const A = '65a000000000000000000001';
const B = '65a000000000000000000002';
const UserModel = User as any;

let userRole: string;
let asked: Array<{ adminId: string; ids: string[] }>;
let failRead: Error | null;
let restore: () => void = () => {};
let plansGET: (r: Request) => Promise<Response>;

const answer = (ids: string[]) => ({
  plans: ids.map((sellerId) => ({
    sellerId,
    plan: { key: 'free', name: 'Free' },
    status: 'none',
    periodEnd: null,
    daysLeft: null,
    limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false },
    used: { stores: 1, products: 4, staffSeats: 0, apiKeys: 0 },
  })),
});

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  plansGET = (await import('../src/app/api/admin/sellers/plans/route')).GET;
});

beforeEach(() => {
  userRole = 'admin';
  asked = [];
  failRead = null;
  const saved = { connect: (mongoose as any).connect, findById: UserModel.findById, read: sellerPlanSteps.read };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => {
    const q: any = { select: () => q, lean: async () => ({ role: userRole }) };
    return q;
  };
  sellerPlanSteps.read = (async (adminId: string, input: { sellerIds: string[] }) => {
    if (failRead) throw failRead;
    asked.push({ adminId, ids: input.sellerIds });
    return answer(input.sellerIds);
  }) as never;
  restore = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findById = saved.findById;
    sellerPlanSteps.read = saved.read;
  };
});

afterEach(() => restore());

const token = () => signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
const get = async (query: string, bearer?: string | null) =>
  plansGET(new Request('http://admin.test/api/admin/sellers/plans' + query, { headers: bearer === null ? {} : { authorization: 'Bearer ' + (bearer ?? (await token())) } }));

test('ids are trimmed, de-duplicated and checked; at most 100, each a 24-character ObjectId, and at least one', () => {
  assert.deepEqual(parseSellerIds(' ' + A + ' , ' + B + ',' + A), [A, B]);
  assert.equal(SELLER_PLANS_MAX, 100);
  for (const bad of [null, '', ' , ', 'nope', A + ',nope', Array.from({ length: 101 }, (_, i) => '65a0000000000000000' + String(1000 + i).slice(1) + '0').join(',')]) {
    assert.throws(() => parseSellerIds(bad), (err: unknown) => err instanceof AdminHttpError && err.status === 400 && err.field === 'ids', String(bad));
  }
});

test('an admin gets the plans of the sellers asked for, read through the signed call as that admin', async () => {
  const res = await get('?ids=' + A + ',' + B);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as { plans: Array<{ sellerId: string; plan: { key: string }; used: { products: number } }> };
  assert.deepEqual(body.plans.map((p) => p.sellerId), [A, B]);
  assert.deepEqual([body.plans[0]!.plan.key, body.plans[0]!.used.products], ['free', 4]);
  assert.deepEqual(asked, [{ adminId: ADMIN_ID, ids: [A, B] }]);
});

test('a bad or missing ids is a 400 naming the field, and the seller backend is not called', async () => {
  for (const query of ['', '?ids=', '?ids=nope', '?ids=' + A + ',x']) {
    const res = await get(query);
    assert.equal(res.status, 400, query);
    assert.equal(((await res.json()) as { field: string }).field, 'ids', query);
  }
  assert.equal(asked.length, 0);
});

test('a non-admin is refused: no session, a seller session and the wrong audience are 401 and nothing is asked of the seller backend', async () => {
  assert.equal((await get('?ids=' + A, null)).status, 401);
  userRole = 'seller';
  assert.equal((await get('?ids=' + A)).status, 401);
  userRole = 'admin';
  const wrong = await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, 'seller-backend');
  assert.equal((await get('?ids=' + A, wrong)).status, 401);
  assert.equal(asked.length, 0);
});

test('when the seller backend is down the answer is its status (503), not a made-up plan', async () => {
  failRead = new AdminHttpError(503, 'Seller plans is unavailable');
  const res = await get('?ids=' + A);
  assert.equal(res.status, 503);
  assert.deepEqual(asked, []);
});
