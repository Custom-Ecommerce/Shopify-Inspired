import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { assertCan, signSession, User, Discount, Review, Product, Store } from '@/lib/services';
import { settleRevalidations } from '../src/lib/revalidate';
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
const StoreModel = Store as any;

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
  return Object.entries(filter).every(([key, value]) => {
    if (value === null) return row[key] === null || row[key] === undefined;
    if (value && typeof value === 'object' && '$ne' in value) return (row[key] ?? null) !== value.$ne;
    return String(row[key]) === String(value);
  });
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
    sFindOne: StoreModel.findOne,
    sExists: StoreModel.exists,
  };
  StoreModel.findOne = () => query([{ _id: STORE }], true);
  StoreModel.exists = async (filter: any) => (String(filter._id) === STORE && String(filter.owner) === USER ? { _id: STORE } : null);
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
    StoreModel.findOne = originals.sFindOne;
    StoreModel.exists = originals.sExists;
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

test('a review status change purges the product it belongs to', async () => {
  seed();
  reviews[0]!.product = '65a0000000000000000000b1';
  const restore = installStubs();
  const saved = { fetch: globalThis.fetch, findById: (Product as any).findById };
  const purged: string[][] = [];
  process.env.STOREFRONT_URL = 'http://storefront.test';
  process.env.REVALIDATE_SECRET = 'purge-secret';
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    purged.push(JSON.parse(String(init.body)).tags);
    return new Response('{}');
  }) as typeof fetch;
  (Product as any).findById = () => ({ select: () => ({ lean: async () => ({ slug: 'blue-shirt' }) }) });
  try {
    const response = await reviewItem.PATCH(authed('PATCH', 'http://seller.test/api/reviews/' + REV1, { status: 'approved' }), params(REV1));
    assert.equal(response.status, 200);
    await settleRevalidations();
    assert.deepEqual(purged, [['store:' + STORE + ':product:blue-shirt', 'store:' + STORE + ':products', 'store:' + STORE + ':categories']]);
  } finally {
    restore();
    globalThis.fetch = saved.fetch;
    (Product as any).findById = saved.findById;
    delete process.env.STOREFRONT_URL;
    delete process.env.REVALIDATE_SECRET;
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

/* ------------------------------------------- EP-15 CB-3 ------------------------------------------- */

const LIST = 'http://seller.test/api/discounts';
const patchDiscount = (id: string, body: unknown, headers: Record<string, string> = {}) => {
  const request = authed('PATCH', LIST + '/' + id, body);
  for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
  return discountItem.PATCH(request, params(id));
};
const listCodes = async (url = LIST): Promise<string[]> => ((await (await discountGET(authed('GET', url))).json()) as { docs: Array<{ code: string }> }).docs.map((d) => d.code);

async function withStubs(run: () => Promise<void>): Promise<void> {
  seed();
  const restore = installStubs();
  try {
    await run();
  } finally {
    restore();
  }
}

test('a seller can change the value, minimum, dates and maximum uses', () =>
  withStubs(async () => {
    const response = await patchDiscount(DISC1, { value: 25, minOrderAmount: 1500, maxUses: 40, startDate: '2026-12-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' });
    assert.equal(response.status, 200);
    const row = discounts.find((d) => d._id === DISC1)!;
    assert.equal(row.value, 25);
    assert.equal(row.minOrderAmount, 1500);
    assert.equal(row.maxUses, 40);
    assert.equal(row.startDate, '2026-12-01T00:00:00.000Z');
  }));

test('the new value is checked against the stored type', () =>
  withStubs(async () => {
    assert.equal((await patchDiscount(DISC1, { value: 101 })).status, 422);
    assert.equal((await patchDiscount(DISC1, { value: 10.5 })).status, 422);
    assert.equal(discounts.find((d) => d._id === DISC1)!.value, 10);
  }));

test('an old type cannot be given a new value, but can still be switched off or archived', () =>
  withStubs(async () => {
    discounts[0]!.type = 'free_delivery';
    assert.equal((await patchDiscount(DISC1, { value: 5 })).status, 422);
    assert.equal((await patchDiscount(DISC1, { isActive: false })).status, 200);
    assert.equal((await patchDiscount(DISC1, { archived: true })).status, 200);
  }));

test('an end date is checked against the start date already stored', () =>
  withStubs(async () => {
    discounts[0]!.startDate = new Date('2026-12-10T00:00:00.000Z');
    assert.equal((await patchDiscount(DISC1, { endDate: '2026-12-01T00:00:00.000Z' })).status, 422);
    assert.equal((await patchDiscount(DISC1, { endDate: '2026-12-20T00:00:00.000Z' })).status, 200);
  }));

test('the code, the type and the use count cannot be patched', () =>
  withStubs(async () => {
    for (const change of [{ code: 'NEW' }, { type: 'fixed_amount' }, { usedCount: 0 }]) {
      assert.equal((await patchDiscount(DISC1, change)).status, 422, JSON.stringify(change));
    }
  }));

test('archive and restore: archived codes are listed apart', () =>
  withStubs(async () => {
    assert.deepEqual(await listCodes(), ['EID10']);
    assert.deepEqual(await listCodes(LIST + '?archived=true'), []);

    assert.equal((await patchDiscount(DISC1, { archived: true })).status, 200);
    const archivedAt = discounts.find((d) => d._id === DISC1)!.archivedAt;
    assert.ok(archivedAt instanceof Date);
    assert.deepEqual(await listCodes(), []);
    assert.deepEqual(await listCodes(LIST + '?archived=true'), ['EID10']);

    assert.equal((await patchDiscount(DISC1, { archived: true })).status, 200);
    assert.equal(discounts.find((d) => d._id === DISC1)!.archivedAt, archivedAt, 'archiving twice keeps the first date');

    assert.equal((await patchDiscount(DISC1, { archived: false })).status, 200);
    assert.equal(discounts.find((d) => d._id === DISC1)!.archivedAt, null);
    assert.deepEqual(await listCodes(), ['EID10']);
  }));

test("Seller B cannot read, change or archive Seller A's code", () =>
  withStubs(async () => {
    const before = JSON.stringify(discounts.find((d) => d._id === DISC2));
    assert.equal((await discountItem.GET(authed('GET', LIST + '/' + DISC2), params(DISC2))).status, 404);
    assert.equal((await patchDiscount(DISC2, { value: 5 })).status, 404);
    assert.equal((await patchDiscount(DISC2, { archived: true })).status, 404);
    assert.equal(JSON.stringify(discounts.find((d) => d._id === DISC2)), before);
    assert.deepEqual(await listCodes(), ['EID10']);
  }));

test('naming a store the seller does not own is refused on every discount route', () =>
  withStubs(async () => {
    const foreign = { 'x-store-id': OTHER_STORE };
    const withStore = (method: string, url: string, body?: unknown) => {
      const request = authed(method, url, body);
      request.headers.set('x-store-id', OTHER_STORE);
      return request;
    };
    assert.equal((await discountGET(withStore('GET', LIST))).status, 403);
    assert.equal((await discountPOST(withStore('POST', LIST, { code: 'NEW', type: 'percentage', value: 10 }))).status, 403);
    assert.equal((await discountItem.GET(withStore('GET', LIST + '/' + DISC2), params(DISC2))).status, 403);
    assert.equal((await patchDiscount(DISC2, { value: 5 }, foreign)).status, 403);
    assert.equal(discounts.length, 2);
  }));

test('a seller with the store named goes to that store', () =>
  withStubs(async () => {
    const request = authed('GET', LIST);
    request.headers.set('x-store-id', STORE);
    assert.equal((await discountGET(request)).status, 200);
  }));

test('a new code of an old type or with a bad value is refused', () =>
  withStubs(async () => {
    for (const body of [{ code: 'A', type: 'free_delivery', value: 1 }, { code: 'A', type: 'buy_x_get_y', value: 1 }, { code: 'A', type: 'percentage', value: 101 }, { code: 'A', type: 'fixed_amount', value: 1.5 }]) {
      assert.equal((await discountPOST(authed('POST', LIST, body))).status, 422, JSON.stringify(body));
    }
    assert.equal(discounts.length, 2);
  }));

test('a code is not case sensitive when created: the same code in lower case is a duplicate', () =>
  withStubs(async () => {
    let stored: any = null;
    DiscountModel.create = async (doc: any) => {
      stored = doc;
      throw Object.assign(new Error('E11000'), { code: 11000 });
    };
    const response = await discountPOST(authed('POST', LIST, { code: 'eid10', type: 'percentage', value: 10 }));
    assert.equal(response.status, 409);
    assert.equal(stored.code, 'EID10');
  }));

test('the policy: sellers change only the allowed fields, and permanent delete stays admin-only', () => {
  assert.doesNotThrow(() => assertCan('seller', 'update', 'discounts', ['value', 'minOrderAmount', 'maxUses', 'startDate', 'endDate', 'isActive', 'archivedAt']));
  for (const field of ['code', 'type', 'usedCount', 'store', 'applicableProducts']) {
    assert.throws(() => assertCan('seller', 'update', 'discounts', [field]), undefined, field);
  }
  assert.throws(() => assertCan('seller', 'delete', 'discounts'));
  assert.doesNotThrow(() => assertCan('admin', 'delete', 'discounts'));
});

test('there is no delete route for a seller', async () => {
  const collection = await import('../src/app/api/discounts/route');
  const item = await import('../src/app/api/discounts/[id]/route');
  assert.equal('DELETE' in collection, false);
  assert.equal('DELETE' in item, false);
});

/* ------------------------------ Sprint 4 SB-1 (CO-57): verified active store ------------------------------ */

test("Seller B naming Seller A's store id is refused on the review list, detail and status change", () =>
  withStubs(async () => {
    const FOREIGN_REVIEW = '65a0000000000000000000e2';
    reviews.push({ _id: FOREIGN_REVIEW, product: '65a000000000000000000022', store: OTHER_STORE, rating: 1, body: 'Foreign review', images: [], status: 'pending', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
    const foreign = (method: string, url: string, body?: unknown) => {
      const request = authed(method, url, body);
      request.headers.set('x-store-id', OTHER_STORE);
      return request;
    };
    const list = await reviewGET(foreign('GET', 'http://seller.test/api/reviews'));
    assert.equal(list.status, 403);
    assert.equal((await list.text()).includes('Foreign review'), false);
    const detail = await reviewItem.GET(foreign('GET', 'http://seller.test/api/reviews/' + FOREIGN_REVIEW), params(FOREIGN_REVIEW));
    assert.equal(detail.status, 403);
    assert.equal((await detail.text()).includes('Foreign review'), false);
    const patch = await reviewItem.PATCH(foreign('PATCH', 'http://seller.test/api/reviews/' + FOREIGN_REVIEW, { status: 'approved' }), params(FOREIGN_REVIEW));
    assert.equal(patch.status, 403);
    assert.equal(reviews.find((r) => r._id === FOREIGN_REVIEW)!.status, 'pending');
  }));
