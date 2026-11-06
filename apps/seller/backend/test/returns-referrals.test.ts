import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { assertCan, signSession, User, Return, Referral } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

const SECRET = 'x'.repeat(40);
const USER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const RET_REQ = '65a0000000000000000000a1';
const RET_OTHER = '65a0000000000000000000a2';
const REF1 = '65a0000000000000000000b1';

const ReturnModel = Return as any;
const ReferralModel = Referral as any;
const UserModel = User as any;

let returns: Array<Record<string, any>> = [];
let referrals: Array<Record<string, any>> = [];
let token = '';

let returnsGET: (request: NextRequest) => Promise<Response>;
let returnItem: { GET: (r: NextRequest, c: any) => Promise<Response>; PATCH: (r: NextRequest, c: any) => Promise<Response> };
let referralsGET: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: USER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  returnsGET = (await import('../src/app/api/returns/route')).GET;
  returnItem = (await import('../src/app/api/returns/[id]/route')) as any;
  referralsGET = (await import('../src/app/api/referrals/route')).GET;
});

function query(rows: unknown[], single = false) {
  const q: any = {
    sort: () => q,
    skip: () => q,
    limit: () => q,
    select: () => q,
    lean: async () => (single ? rows[0] ?? null : rows),
  };
  return q;
}

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
}

function installStubs(): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    rFind: ReturnModel.find,
    rCount: ReturnModel.countDocuments,
    rFindOne: ReturnModel.findOne,
    rUpdate: ReturnModel.findOneAndUpdate,
    fFind: ReferralModel.find,
    fCount: ReferralModel.countDocuments,
    uFindById: UserModel.findById,
  };
  (mongoose as any).connect = async () => mongoose;
  ReturnModel.find = (filter: any) => query(returns.filter((r) => matches(r, filter)));
  ReturnModel.countDocuments = async (filter: any) => returns.filter((r) => matches(r, filter)).length;
  ReturnModel.findOne = (filter: any) => query(returns.filter((r) => matches(r, filter)), true);
  ReturnModel.findOneAndUpdate = (filter: any, update: any) => {
    const row = returns.find((r) => matches(r, filter));
    if (!row) return query([], true);
    Object.assign(row, update.$set);
    return query([row], true);
  };
  ReferralModel.find = (filter: any) => query(referrals.filter((r) => matches(r, filter)));
  ReferralModel.countDocuments = async (filter: any) => referrals.filter((r) => matches(r, filter)).length;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ store: STORE }) }) });
  return () => {
    (mongoose as any).connect = originals.connect;
    ReturnModel.find = originals.rFind;
    ReturnModel.countDocuments = originals.rCount;
    ReturnModel.findOne = originals.rFindOne;
    ReturnModel.findOneAndUpdate = originals.rUpdate;
    ReferralModel.find = originals.fFind;
    ReferralModel.countDocuments = originals.fCount;
    UserModel.findById = originals.uFindById;
  };
}

function seed() {
  const now = '2026-10-01T00:00:00.000Z';
  returns = [
    { _id: RET_REQ, order: '65a0000000000000000000c1', store: STORE, reason: 'damaged', images: [], status: 'requested', createdAt: now, updatedAt: now },
    { _id: RET_OTHER, order: '65a0000000000000000000c2', store: OTHER_STORE, reason: 'other', images: [], status: 'requested', createdAt: now, updatedAt: now },
  ];
  referrals = [
    { _id: REF1, referrer: STORE, referred: '65a0000000000000000000d9', status: 'pending', createdAt: now, updatedAt: now },
    { _id: '65a0000000000000000000b2', referrer: OTHER_STORE, referred: '65a0000000000000000000d8', status: 'pending', createdAt: now, updatedAt: now },
  ];
}

function authed(method: string, url: string, body?: unknown, bearer = token): NextRequest {
  const headers: Record<string, string> = { authorization: 'Bearer ' + bearer };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

test('returns require a session: no token is refused with 401', async () => {
  const response = await returnsGET(new NextRequest('http://seller.test/api/returns'));
  assert.equal(response.status, 401);
});

test('the return list returns only the seller store, in the list envelope', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await returnsGET(authed('GET', 'http://seller.test/api/returns'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { docs: Array<Record<string, unknown>>; totalDocs: number };
    assert.equal(body.totalDocs, 1);
    assert.equal(body.docs[0].id, RET_REQ);
    assert.equal('_id' in body.docs[0], false);
  } finally {
    restore();
  }
});

test('an unknown status filter on returns is refused with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await returnsGET(authed('GET', 'http://seller.test/api/returns?status=maybe'));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('a requested return can be approved with a refund, and the change is kept', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await returnItem.PATCH(
      authed('PATCH', 'http://seller.test/api/returns/' + RET_REQ, { status: 'approved', refundType: 'store_credit', refundAmount: 500 }),
      params(RET_REQ),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; refundType: string; refundAmount: number };
    assert.equal(body.status, 'approved');
    assert.equal(body.refundType, 'store_credit');
    assert.equal(body.refundAmount, 500);
  } finally {
    restore();
  }
});

test('a return cannot skip a step: requested straight to completed is refused with 409', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await returnItem.PATCH(authed('PATCH', 'http://seller.test/api/returns/' + RET_REQ, { status: 'completed' }), params(RET_REQ));
    assert.equal(response.status, 409);
    assert.equal(returns[0].status, 'requested');
  } finally {
    restore();
  }
});

test('an update outside the allowlist (order) is refused with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await returnItem.PATCH(authed('PATCH', 'http://seller.test/api/returns/' + RET_REQ, { order: '65a0000000000000000000c9' }), params(RET_REQ));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test("another store's return is answered with 404 and not changed", async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await returnItem.PATCH(authed('PATCH', 'http://seller.test/api/returns/' + RET_OTHER, { status: 'approved' }), params(RET_OTHER));
    assert.equal(response.status, 404);
    assert.equal(returns[1].status, 'requested');
  } finally {
    restore();
  }
});

test('the referral list returns only referrals where the seller store is the referrer', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await referralsGET(authed('GET', 'http://seller.test/api/referrals'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { docs: Array<Record<string, unknown>>; totalDocs: number };
    assert.equal(body.totalDocs, 1);
    assert.equal(body.docs[0].id, REF1);
  } finally {
    restore();
  }
});

test('the policy: sellers approve returns, but cannot create returns or change referrals', () => {
  assert.doesNotThrow(() => assertCan('seller', 'update', 'returns', ['status', 'refundType']));
  assert.throws(() => assertCan('seller', 'update', 'returns', ['order']));
  assert.throws(() => assertCan('seller', 'create', 'returns'));
  assert.throws(() => assertCan('seller', 'update', 'referrals', ['status']));
  assert.doesNotThrow(() => assertCan('seller', 'read', 'referrals'));
});
