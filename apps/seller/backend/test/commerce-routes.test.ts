import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { assertCan, signSession, User, Discount, Review } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

const SECRET = 'x'.repeat(40);
const ADMIN_AUDIENCE = 'admin-backend';
const USER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const DISC1 = '65a0000000000000000000d1';
const DISC2 = '65a0000000000000000000d2';
const REV1 = '65a0000000000000000000e1';

const DiscountModel = Discount as any;
const ReviewModel = Review as any;
const UserModel = User as any;

let discounts: Array<Record<string, any>> = [];
let reviews: Array<Record<string, any>> = [];
let nextId = 100;
let token = '';

let discountGET: (request: NextRequest) => Promise<Response>;
let discountPOST: (request: NextRequest) => Promise<Response>;
let discountItem: { GET: (r: NextRequest, c: any) => Promise<Response>; PATCH: (r: NextRequest, c: any) => Promise<Response> };
let reviewGET: (request: NextRequest) => Promise<Response>;
let reviewItem: { GET: (r: NextRequest, c: any) => Promise<Response>; PATCH: (r: NextRequest, c: any) => Promise<Response> };

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: USER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  discountGET = (await import('../src/app/api/discounts/route')).GET;
  discountPOST = (await import('../src/app/api/discounts/route')).POST;
  discountItem = (await import('../src/app/api/discounts/[id]/route')) as any;
  reviewGET = (await import('../src/app/api/reviews/route')).GET;
  reviewItem = (await import('../src/app/api/reviews/[id]/route')) as any;
});

/** A query stub: the chain methods return the query, and lean resolves to the rows or the single row. */
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
    dFind: DiscountModel.find,
    dCount: DiscountModel.countDocuments,
    dFindOne: DiscountModel.findOne,
    dCreate: DiscountModel.create,
    dUpdate: DiscountModel.findOneAndUpdate,
    rFind: ReviewModel.find,
    rCount: ReviewModel.countDocuments,
    rFindOne: ReviewModel.findOne,
    rUpdate: ReviewModel.findOneAndUpdate,
    uFindById: UserModel.findById,
  };
  (mongoose as any).connect = async () => mongoose;
  DiscountModel.find = (filter: any) => query(discounts.filter((r) => matches(r, filter)));
  DiscountModel.countDocuments = async (filter: any) => discounts.filter((r) => matches(r, filter)).length;
  DiscountModel.findOne = (filter: any) => query(discounts.filter((r) => matches(r, filter)), true);
  DiscountModel.create = async (doc: any) => {
    const row = { _id: String(nextId++), ...doc, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
    discounts.push(row);
    return row;
  };
  DiscountModel.findOneAndUpdate = (filter: any, update: any) => {
    const row = discounts.find((r) => matches(r, filter));
    if (!row) return query([], true);
    Object.assign(row, update.$set);
    return query([row], true);
  };
  ReviewModel.find = (filter: any) => query(reviews.filter((r) => matches(r, filter)));
  ReviewModel.countDocuments = async (filter: any) => reviews.filter((r) => matches(r, filter)).length;
  ReviewModel.findOne = (filter: any) => query(reviews.filter((r) => matches(r, filter)), true);
  ReviewModel.findOneAndUpdate = (filter: any, update: any) => {
    const row = reviews.find((r) => matches(r, filter));
    if (!row) return query([], true);
    Object.assign(row, update.$set);
    return query([row], true);
  };
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ store: STORE }) }) });
  return () => {
    (mongoose as any).connect = originals.connect;
    DiscountModel.find = originals.dFind;
    DiscountModel.countDocuments = originals.dCount;
    DiscountModel.findOne = originals.dFindOne;
    DiscountModel.create = originals.dCreate;
    DiscountModel.findOneAndUpdate = originals.dUpdate;
    ReviewModel.find = originals.rFind;
    ReviewModel.countDocuments = originals.rCount;
    ReviewModel.findOne = originals.rFindOne;
    ReviewModel.findOneAndUpdate = originals.rUpdate;
    UserModel.findById = originals.uFindById;
  };
}

function seed() {
  discounts = [
    { _id: DISC1, store: STORE, code: 'EID10', type: 'percentage', value: 10, usedCount: 0, applicableProducts: [], isActive: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
    { _id: DISC2, store: OTHER_STORE, code: 'OTHER', type: 'fixed_amount', value: 500, usedCount: 0, applicableProducts: [], isActive: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
  ];
  reviews = [
    { _id: REV1, product: '65a000000000000000000021', store: STORE, rating: 4, body: 'Good', images: [], status: 'pending', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
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

test('discounts require a session: no token is refused with 401', async () => {
  const response = await discountGET(new NextRequest('http://seller.test/api/discounts'));
  assert.equal(response.status, 401);
});

test('a token minted for the admin audience is refused on discounts (cross-backend)', async () => {
  const adminToken = await signSession({ sub: USER, role: 'seller' }, SECRET, ADMIN_AUDIENCE);
  const response = await discountGET(authed('GET', 'http://seller.test/api/discounts', undefined, adminToken));
  assert.equal(response.status, 401);
});

test('the discount list returns only the seller store, in the list envelope with wire ids', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await discountGET(authed('GET', 'http://seller.test/api/discounts'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { docs: Array<Record<string, unknown>>; totalDocs: number; page: number };
    assert.equal(body.totalDocs, 1);
    assert.equal(body.page, 1);
    assert.equal(body.docs[0].id, DISC1);
    assert.equal('_id' in body.docs[0], false);
    assert.equal(body.docs[0].code, 'EID10');
  } finally {
    restore();
  }
});

test('creating a discount stores it under the seller store with an upper-case code and answers 201', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await discountPOST(authed('POST', 'http://seller.test/api/discounts', { code: 'winter25', type: 'percentage', value: 25 }));
    assert.equal(response.status, 201);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.code, 'WINTER25');
    assert.equal(body.store, STORE);
    assert.equal(body.usedCount, 0);
  } finally {
    restore();
  }
});

test('a create request that names a store is refused with 422 (the store comes from the session)', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await discountPOST(authed('POST', 'http://seller.test/api/discounts', { code: 'X', type: 'percentage', value: 1, store: OTHER_STORE }));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('a create request with an unknown discount type is refused with 422 naming the field', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await discountPOST(authed('POST', 'http://seller.test/api/discounts', { code: 'X', type: 'bogus', value: 1 }));
    assert.equal(response.status, 422);
    const text = await response.text();
    assert.ok(text.includes('type'), text);
  } finally {
    restore();
  }
});

test('a discount can be switched off, and the change is kept', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await discountItem.PATCH(authed('PATCH', 'http://seller.test/api/discounts/' + DISC1, { isActive: false }), params(DISC1));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { isActive: boolean };
    assert.equal(body.isActive, false);
  } finally {
    restore();
  }
});

test("another store's discount is answered with 404, not its contents", async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await discountItem.GET(authed('GET', 'http://seller.test/api/discounts/' + DISC2), params(DISC2));
    assert.equal(response.status, 404);
    const text = await response.text();
    assert.equal(text.includes('OTHER'), false);
  } finally {
    restore();
  }
});

test('an update that names a field outside the allowlist (store) is refused with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await discountItem.PATCH(authed('PATCH', 'http://seller.test/api/discounts/' + DISC1, { store: OTHER_STORE }), params(DISC1));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('a malformed discount id is refused with 422 before the database is touched', async () => {
  const response = await discountItem.GET(authed('GET', 'http://seller.test/api/discounts/nope'), params('nope'));
  assert.equal(response.status, 422);
});

test('the review list rejects an unknown status filter with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await reviewGET(authed('GET', 'http://seller.test/api/reviews?status=maybe'));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('a seller can approve a review in their store', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await reviewItem.PATCH(authed('PATCH', 'http://seller.test/api/reviews/' + REV1, { status: 'approved' }), params(REV1));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, 'approved');
  } finally {
    restore();
  }
});

test('a seller cannot change a review body: only the status is accepted', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await reviewItem.PATCH(authed('PATCH', 'http://seller.test/api/reviews/' + REV1, { status: 'approved', body: 'edited' }), params(REV1));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('the policy declares discounts and reviews, with sellers limited to the status of a review', () => {
  assert.doesNotThrow(() => assertCan('seller', 'read', 'discounts'));
  assert.doesNotThrow(() => assertCan('seller', 'update', 'reviews', ['status']));
  assert.throws(() => assertCan('seller', 'delete', 'discounts'));
});
