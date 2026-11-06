import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Category, Product, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

const SECRET = 'x'.repeat(40);

const SELLER_A = '65a000000000000000000001';
const SELLER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';

const STORE_A = '65a000000000000000000011';
const STORE_A2 = '65a000000000000000000013';
const STORE_B = '65a000000000000000000012';

const CAT_A1 = '65a0000000000000000000c1';
const CAT_A2 = '65a0000000000000000000c2';
const CAT_A3 = '65a0000000000000000000c3';
const CAT_B1 = '65a0000000000000000000c4';

const NOW = '2026-10-01T00:00:00.000Z';

interface CategoryRow {
  _id: string;
  store: string;
  name: string;
  slug: string;
  order: number;
  description: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductRow {
  store: string;
  categories: string[];
}

interface StoreRow {
  _id: string;
  owner: string;
}

type Filter = Record<string, unknown>;

/** The part of a Mongoose query these routes use. */
interface StubQuery {
  sort: (spec: Record<string, 1 | -1>) => StubQuery;
  skip: (count: number) => StubQuery;
  limit: (count: number) => StubQuery;
  select: (fields: string) => StubQuery;
  lean: () => Promise<unknown>;
}

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const CategoryStub = Category as unknown as {
  find: (filter: Filter) => StubQuery;
  findOne: (filter: Filter) => StubQuery;
  countDocuments: (filter: Filter) => Promise<number>;
  create: (doc: Filter) => Promise<CategoryRow>;
  findOneAndUpdate: (filter: Filter, update: { $set: Filter }) => StubQuery;
  deleteOne: (filter: Filter) => Promise<unknown>;
};
const ProductStub = Product as unknown as { countDocuments: (filter: Filter) => Promise<number> };
const StoreStub = Store as unknown as {
  exists: (filter: Filter) => Promise<unknown>;
  findOne: (filter: Filter) => StubQuery;
};

type RouteContext = { params: Promise<{ id: string }> };
type CollectionHandler = (request: NextRequest) => Promise<Response>;
type ItemHandler = (request: NextRequest, context: RouteContext) => Promise<Response>;

let listGET: CollectionHandler;
let createPOST: CollectionHandler;
let itemGET: ItemHandler;
let itemPATCH: ItemHandler;
let itemDELETE: ItemHandler;

let tokenA = '';
let tokenB = '';
let adminToken = '';

let categories: CategoryRow[];
let products: ProductRow[];
let stores: StoreRow[];
let nextId: number;
let restore: () => void;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: SELLER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: SELLER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  adminToken = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  const collection = await import('../src/app/api/categories/route');
  const item = await import('../src/app/api/categories/[id]/route');
  listGET = collection.GET;
  createPOST = collection.POST;
  itemGET = item.GET;
  itemPATCH = item.PATCH;
  itemDELETE = item.DELETE;
});

const same = (row: object, filter: Filter): boolean =>
  Object.entries(filter).every(([key, value]) => String((row as Record<string, unknown>)[key]) === String(value));

function compare(a: Record<string, unknown>, b: Record<string, unknown>, spec: Record<string, 1 | -1>): number {
  for (const [key, direction] of Object.entries(spec)) {
    const left = a[key];
    const right = b[key];
    if (left === right) continue;
    const before = typeof left === 'number' && typeof right === 'number' ? left < right : String(left) < String(right);
    return (before ? -1 : 1) * direction;
  }
  return 0;
}

/** A query over rows that really sorts, skips, and limits, so a route's arguments are what is tested. */
function query(rows: object[], single: boolean): StubQuery {
  let result = [...rows] as Array<Record<string, unknown>>;
  const q: StubQuery = {
    sort: (spec) => {
      result = [...result].sort((a, b) => compare(a, b, spec));
      return q;
    },
    skip: (count) => {
      result = result.slice(count);
      return q;
    },
    limit: (count) => {
      result = result.slice(0, count);
      return q;
    },
    select: () => q,
    lean: async () => (single ? (result[0] ?? null) : result),
  };
  return q;
}

/** The unique (store, slug) index, as the database enforces it. */
function assertSlugFree(store: string, slug: unknown, except?: string): void {
  if (categories.some((row) => row.store === store && row.slug === slug && row._id !== except)) {
    throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
  }
}

beforeEach(() => {
  categories = [
    { _id: CAT_A1, store: STORE_A, name: 'Zari', slug: 'zari', order: 0, description: null, isDemo: false, createdAt: NOW, updatedAt: NOW },
    { _id: CAT_A2, store: STORE_A, name: 'Lawn', slug: 'lawn', order: 1, description: null, isDemo: false, createdAt: NOW, updatedAt: NOW },
    { _id: CAT_A3, store: STORE_A, name: 'Chiffon', slug: 'chiffon', order: 1, description: null, isDemo: false, createdAt: NOW, updatedAt: NOW },
    { _id: CAT_B1, store: STORE_B, name: 'Shoes', slug: 'shoes', order: 0, description: null, isDemo: false, createdAt: NOW, updatedAt: NOW },
  ];
  products = [];
  stores = [
    { _id: STORE_A, owner: SELLER_A },
    { _id: STORE_A2, owner: SELLER_A },
    { _id: STORE_B, owner: SELLER_B },
  ];
  nextId = 0xd0;

  const saved = {
    connect: mongooseStub.connect,
    find: CategoryStub.find,
    findOne: CategoryStub.findOne,
    count: CategoryStub.countDocuments,
    create: CategoryStub.create,
    update: CategoryStub.findOneAndUpdate,
    remove: CategoryStub.deleteOne,
    productCount: ProductStub.countDocuments,
    storeExists: StoreStub.exists,
    storeFindOne: StoreStub.findOne,
  };

  mongooseStub.connect = async () => mongoose;
  CategoryStub.find = (filter) => query(categories.filter((row) => same(row, filter)), false);
  CategoryStub.findOne = (filter) => query(categories.filter((row) => same(row, filter)), true);
  CategoryStub.countDocuments = async (filter) => categories.filter((row) => same(row, filter)).length;
  CategoryStub.create = async (doc) => {
    assertSlugFree(String(doc.store), doc.slug);
    const row: CategoryRow = {
      _id: '65a0000000000000000000' + (nextId++).toString(16),
      store: String(doc.store),
      name: String(doc.name),
      slug: String(doc.slug),
      order: Number(doc.order),
      description: (doc.description as string | null | undefined) ?? null,
      isDemo: false,
      createdAt: NOW,
      updatedAt: NOW,
    };
    categories.push(row);
    return row;
  };
  CategoryStub.findOneAndUpdate = (filter, update) => {
    const row = categories.find((candidate) => same(candidate, filter));
    if (row && update.$set.slug !== undefined) assertSlugFree(row.store, update.$set.slug, row._id);
    if (row) Object.assign(row, update.$set);
    return query(row ? [row] : [], true);
  };
  CategoryStub.deleteOne = async (filter) => {
    categories = categories.filter((row) => !same(row, filter));
    return { deletedCount: 1 };
  };
  ProductStub.countDocuments = async (filter) =>
    products.filter(
      (row) =>
        row.store === String(filter.store) &&
        row.categories.includes(String(filter.categories)) &&
        (filter.deletedAt === undefined || (row as { deletedAt?: unknown }).deletedAt),
    ).length;
  StoreStub.exists = async (filter) => (stores.some((row) => same(row, filter)) ? { _id: filter._id } : null);
  StoreStub.findOne = (filter) => query(stores.filter((row) => same(row, filter)), true);

  restore = () => {
    mongooseStub.connect = saved.connect;
    CategoryStub.find = saved.find;
    CategoryStub.findOne = saved.findOne;
    CategoryStub.countDocuments = saved.count;
    CategoryStub.create = saved.create;
    CategoryStub.findOneAndUpdate = saved.update;
    CategoryStub.deleteOne = saved.remove;
    ProductStub.countDocuments = saved.productCount;
    StoreStub.exists = saved.storeExists;
    StoreStub.findOne = saved.storeFindOne;
  };
});

afterEach(() => restore());

interface Call {
  token?: string;
  storeHeader?: string;
  body?: unknown;
  query?: string;
}

function request(method: string, path: string, call: Call = {}): NextRequest {
  const token = call.token ?? tokenA;
  const headers: Record<string, string> = { authorization: 'Bearer ' + token };
  if (call.storeHeader) headers['x-store-id'] = call.storeHeader;
  if (call.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest('http://seller.test' + path + (call.query ?? ''), {
    method,
    headers,
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
  });
}

const ctx = (id: string): RouteContext => ({ params: Promise.resolve({ id }) });
const row = (id: string): CategoryRow | undefined => categories.find((candidate) => candidate._id === id);
const errorCode = async (res: Response): Promise<unknown> => ((await res.json()) as { errors: Array<{ code?: unknown }> }).errors[0].code;

test('every category route needs a session', async () => {
  const anonymous = new NextRequest('http://seller.test/api/categories');
  assert.equal((await listGET(anonymous)).status, 401);
  assert.equal((await createPOST(new NextRequest('http://seller.test/api/categories', { method: 'POST', body: '{"name":"X"}' }))).status, 401);
  assert.equal((await itemGET(anonymous, ctx(CAT_A1))).status, 401);
});

test('the list holds only the store of the seller, by order then name, in the list envelope', async () => {
  const res = await listGET(request('GET', '/api/categories'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as { docs: Array<Record<string, unknown>>; totalDocs: number; limit: number };
  assert.deepEqual(body.docs.map((doc) => doc.slug), ['zari', 'chiffon', 'lawn']);
  assert.equal(body.totalDocs, 3);
  assert.equal(body.limit, 50);
  assert.equal(body.docs[0].id, CAT_A1);
  assert.equal(body.docs[0]._id, undefined);
});

test('create makes the slug from the name, goes last, and is bound to the store of the seller', async () => {
  const res = await createPOST(request('POST', '/api/categories', { body: { name: 'Summer Lawn 2026!', description: 'Light fabrics' } }));
  assert.equal(res.status, 201);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.slug, 'summer-lawn-2026');
  assert.equal(body.store, STORE_A);
  assert.equal(body.order, 2);
  assert.equal(body.description, 'Light fabrics');
  assert.equal(body.isDemo, false);
  assert.equal(categories.length, 5);
});

test('create and update refuse a store, isDemo, and unknown fields in the body', async () => {
  for (const extra of [{ store: STORE_B }, { storeId: STORE_B }, { isDemo: true }, { banner: CAT_A1 }]) {
    const created = await createPOST(request('POST', '/api/categories', { body: { name: 'New', ...extra } }));
    assert.equal(created.status, 422, JSON.stringify(extra));
    const updated = await itemPATCH(request('PATCH', '/api/categories/' + CAT_A1, { body: { name: 'New', ...extra } }), ctx(CAT_A1));
    assert.equal(updated.status, 422, JSON.stringify(extra));
  }
  assert.equal(categories.length, 4);
  assert.equal(row(CAT_A1)?.name, 'Zari');
});

test('a slug clash inside a store is a 409, and an explicit slug is checked the same way', async () => {
  const fromName = await createPOST(request('POST', '/api/categories', { body: { name: 'Lawn' } }));
  assert.equal(fromName.status, 409);
  assert.equal(await errorCode(fromName), 'CATEGORY_SLUG_TAKEN');

  const explicit = await createPOST(request('POST', '/api/categories', { body: { name: 'Something else', slug: 'zari' } }));
  assert.equal(explicit.status, 409);
  assert.equal(categories.length, 4);
});

test('two stores may use the same slug', async () => {
  const res = await createPOST(request('POST', '/api/categories', { token: tokenB, body: { name: 'Lawn' } }));
  assert.equal(res.status, 201);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.slug, 'lawn');
  assert.equal(body.store, STORE_B);
  assert.equal(categories.filter((candidate) => candidate.slug === 'lawn').length, 2);
});

test('a name with no Latin letters needs a slug, and creates once one is sent', async () => {
  const refused = await createPOST(request('POST', '/api/categories', { body: { name: 'کپڑے' } }));
  assert.equal(refused.status, 422);
  assert.equal(await errorCode(refused), 'CATEGORY_SLUG_REQUIRED');

  const accepted = await createPOST(request('POST', '/api/categories', { body: { name: 'کپڑے', slug: 'kapray' } }));
  assert.equal(accepted.status, 201);
});

test('one category reads back by id', async () => {
  const res = await itemGET(request('GET', '/api/categories/' + CAT_A2), ctx(CAT_A2));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Record<string, unknown>).slug, 'lawn');
});

test('update changes only what is sent: a new name keeps the slug, and the slug can be edited', async () => {
  const renamed = await itemPATCH(request('PATCH', '/api/categories/' + CAT_A2, { body: { name: 'Fine Lawn' } }), ctx(CAT_A2));
  assert.equal(renamed.status, 200);
  assert.equal(row(CAT_A2)?.name, 'Fine Lawn');
  assert.equal(row(CAT_A2)?.slug, 'lawn');

  const reslugged = await itemPATCH(request('PATCH', '/api/categories/' + CAT_A2, { body: { slug: 'fine-lawn', order: 7 } }), ctx(CAT_A2));
  assert.equal(reslugged.status, 200);
  assert.equal(row(CAT_A2)?.slug, 'fine-lawn');
  assert.equal(row(CAT_A2)?.order, 7);
});

test('update refuses a slug another category of the store holds, but a category may keep its own', async () => {
  const clash = await itemPATCH(request('PATCH', '/api/categories/' + CAT_A2, { body: { slug: 'zari' } }), ctx(CAT_A2));
  assert.equal(clash.status, 409);
  assert.equal(await errorCode(clash), 'CATEGORY_SLUG_TAKEN');
  assert.equal(row(CAT_A2)?.slug, 'lawn');

  const own = await itemPATCH(request('PATCH', '/api/categories/' + CAT_A2, { body: { slug: 'lawn' } }), ctx(CAT_A2));
  assert.equal(own.status, 200);
});

test('an empty update and a malformed id are refused with 422', async () => {
  assert.equal((await itemPATCH(request('PATCH', '/api/categories/' + CAT_A1, { body: {} }), ctx(CAT_A1))).status, 422);
  assert.equal((await itemGET(request('GET', '/api/categories/nope'), ctx('nope'))).status, 422);
  assert.equal((await itemDELETE(request('DELETE', '/api/categories/nope'), ctx('nope'))).status, 422);
});

test("another seller's category is 404 on read, update, and delete, and is left untouched", async () => {
  const path = '/api/categories/' + CAT_B1;
  assert.equal((await itemGET(request('GET', path), ctx(CAT_B1))).status, 404);
  assert.equal((await itemPATCH(request('PATCH', path, { body: { name: 'Stolen' } }), ctx(CAT_B1))).status, 404);
  assert.equal((await itemDELETE(request('DELETE', path), ctx(CAT_B1))).status, 404);
  assert.equal(row(CAT_B1)?.name, 'Shoes');
});

test('a seller with several stores works in the store the dashboard names', async () => {
  const created = await createPOST(request('POST', '/api/categories', { storeHeader: STORE_A2, body: { name: 'Lawn' } }));
  assert.equal(created.status, 201);
  assert.equal(((await created.json()) as Record<string, unknown>).store, STORE_A2);

  const list = await listGET(request('GET', '/api/categories', { storeHeader: STORE_A2 }));
  const body = (await list.json()) as { docs: Array<Record<string, unknown>> };
  assert.deepEqual(body.docs.map((doc) => doc.slug), ['lawn']);

  // The first store's category is out of reach from the second store.
  assert.equal((await itemGET(request('GET', '/api/categories/' + CAT_A1, { storeHeader: STORE_A2 }), ctx(CAT_A1))).status, 404);
});

test('a store the seller does not own is refused, whether named by header or by query', async () => {
  assert.equal((await listGET(request('GET', '/api/categories', { storeHeader: STORE_B }))).status, 403);
  assert.equal((await listGET(request('GET', '/api/categories', { query: '?storeId=' + STORE_B }))).status, 403);
  assert.equal((await createPOST(request('POST', '/api/categories', { storeHeader: STORE_B, body: { name: 'Sneaky' } }))).status, 403);
  assert.equal((await createPOST(request('POST', '/api/categories', { query: '?storeId=' + STORE_B, body: { name: 'Sneaky' } }))).status, 403);
  assert.equal(categories.length, 4);

  const owned = await listGET(request('GET', '/api/categories', { query: '?storeId=' + STORE_A2 }));
  assert.equal(owned.status, 200);
  assert.deepEqual(((await owned.json()) as { docs: unknown[] }).docs, []);

  const mismatch = await listGET(request('GET', '/api/categories', { storeHeader: STORE_A, query: '?storeId=' + STORE_A2 }));
  assert.equal(mismatch.status, 403);
});

test('delete removes an unused category', async () => {
  const res = await itemDELETE(request('DELETE', '/api/categories/' + CAT_A1), ctx(CAT_A1));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true, id: CAT_A1 });
  assert.equal(row(CAT_A1), undefined);
});

test('delete is refused with 409 CATEGORY_IN_USE and the count while products use the category', async () => {
  products = [
    { store: STORE_A, categories: [CAT_A1] },
    { store: STORE_A, categories: [CAT_A2, CAT_A1] },
  ];
  const res = await itemDELETE(request('DELETE', '/api/categories/' + CAT_A1), ctx(CAT_A1));
  assert.equal(res.status, 409);
  const body = (await res.json()) as { errors: Array<{ code: string; productCount: number; message: string }> };
  assert.equal(body.errors[0].code, 'CATEGORY_IN_USE');
  assert.equal(body.errors[0].productCount, 2);
  assert.match(body.errors[0].message, /2 products/);
  assert.ok(row(CAT_A1));

  products = [];
  assert.equal((await itemDELETE(request('DELETE', '/api/categories/' + CAT_A1), ctx(CAT_A1))).status, 200);
});

test('a trashed product still holds its category, and the refusal says so (D-030)', async () => {
  products = [{ store: STORE_A, categories: [CAT_A1], deletedAt: NOW } as (typeof products)[number]];
  const res = await itemDELETE(request('DELETE', '/api/categories/' + CAT_A1), ctx(CAT_A1));
  assert.equal(res.status, 409);
  const body = (await res.json()) as { errors: Array<{ productCount: number; trashedCount: number; message: string }> };
  assert.equal(body.errors[0].productCount, 1);
  assert.equal(body.errors[0].trashedCount, 1);
  assert.match(body.errors[0].message, /1 in trash/);
});

test('the delete guard counts only the products of this store', async () => {
  products = [{ store: STORE_B, categories: [CAT_A1] }];
  assert.equal((await itemDELETE(request('DELETE', '/api/categories/' + CAT_A1), ctx(CAT_A1))).status, 200);
});

test('an admin session may read but never write a category', async () => {
  const token = adminToken;
  assert.equal((await listGET(request('GET', '/api/categories', { token, storeHeader: STORE_A }))).status, 200);
  assert.equal((await createPOST(request('POST', '/api/categories', { token, storeHeader: STORE_A, body: { name: 'Admin' } }))).status, 403);
  const path = '/api/categories/' + CAT_A1;
  assert.equal((await itemPATCH(request('PATCH', path, { token, storeHeader: STORE_A, body: { name: 'Admin' } }), ctx(CAT_A1))).status, 403);
  assert.equal((await itemDELETE(request('DELETE', path, { token, storeHeader: STORE_A }), ctx(CAT_A1))).status, 403);
  assert.equal(row(CAT_A1)?.name, 'Zari');
});

test('an edit makes a demo category the seller\'s own; moving it in the list does not', async () => {
  const demo = row(CAT_A1);
  assert.ok(demo);
  demo.isDemo = true;

  assert.equal((await itemPATCH(request('PATCH', '/api/categories/' + CAT_A1, { body: { order: 5 } }), ctx(CAT_A1))).status, 200);
  assert.equal(demo.isDemo, true);

  assert.equal((await itemPATCH(request('PATCH', '/api/categories/' + CAT_A1, { body: { name: 'Mine' } }), ctx(CAT_A1))).status, 200);
  assert.equal(demo.isDemo, false);
});
