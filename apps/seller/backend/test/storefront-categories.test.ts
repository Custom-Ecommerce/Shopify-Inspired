import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Category, Product, Store } from '@/lib/services';
import { storefrontCategoryListResponseSchema } from '@/lib/contracts';

const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const PENDING = '65a000000000000000000013';

const LAWN = '65a0000000000000000000c1';
const ZARI = '65a0000000000000000000c2';
const EMPTY = '65a0000000000000000000c3';
const DRAFTS_ONLY = '65a0000000000000000000c4';
const FOREIGN = '65a0000000000000000000c5';

interface CategoryRow {
  _id: string;
  store: string;
  name: string;
  slug: string;
  order: number;
  description: string | null;
  isDemo: boolean;
  banner?: { url: string } | null;
}

interface ProductRow {
  store: string;
  isPublished: boolean;
  isDemo?: boolean;
  deletedAt?: string | null;
  categories: string[];
}

interface StoreRow {
  _id: string;
  status: string;
}

interface CategoryFilter {
  store: string;
  _id: { $in: string[] };
}

/** The part of a Mongoose query this route uses. */
interface StubQuery {
  select: () => StubQuery;
  sort: (spec: Record<string, 1 | -1>) => StubQuery;
  populate: () => StubQuery;
  lean: () => Promise<unknown>;
}

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const StoreStub = Store as unknown as { findById: (id: string) => StubQuery };
const ProductStub = Product as unknown as {
  distinct: (field: string, filter: { store: string; isPublished: boolean }) => Promise<string[]>;
};
const CategoryStub = Category as unknown as { find: (filter: CategoryFilter) => StubQuery };

type RouteContext = { params: Promise<{ id: string }> };

let categoriesGET: (request: NextRequest, context: RouteContext) => Promise<Response>;
let stores: StoreRow[];
let products: ProductRow[];
let categories: CategoryRow[];
let catalogReads: number;
let restore: () => void;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  categoriesGET = (await import('../src/app/api/storefront/v1/stores/[id]/categories/route')).GET;
});

function rowsQuery(rows: object[]): StubQuery {
  let result = [...rows] as CategoryRow[];
  const q: StubQuery = {
    select: () => q,
    sort: () => {
      result = [...result].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      return q;
    },
    populate: () => q,
    lean: async () => result,
  };
  return q;
}

function oneQuery(row: object | null): StubQuery {
  const q: StubQuery = { select: () => q, sort: () => q, populate: () => q, lean: async () => row };
  return q;
}

beforeEach(() => {
  stores = [
    { _id: STORE_A, status: 'active' },
    { _id: STORE_B, status: 'active' },
    { _id: PENDING, status: 'pending' },
  ];
  categories = [
    { _id: ZARI, store: STORE_A, name: 'Zari', slug: 'zari', order: 2, description: null, isDemo: false },
    { _id: LAWN, store: STORE_A, name: 'Lawn', slug: 'lawn', order: 1, description: 'Light', isDemo: false, banner: { url: 'https://cdn.test/lawn.jpg' } },
    { _id: EMPTY, store: STORE_A, name: 'Empty', slug: 'empty', order: 0, description: null, isDemo: false },
    { _id: DRAFTS_ONLY, store: STORE_A, name: 'Coming soon', slug: 'coming-soon', order: 0, description: null, isDemo: true },
    { _id: FOREIGN, store: STORE_B, name: 'Shoes', slug: 'lawn', order: 0, description: null, isDemo: false },
  ];
  products = [
    { store: STORE_A, isPublished: true, categories: [ZARI, LAWN] },
    { store: STORE_A, isPublished: false, categories: [DRAFTS_ONLY] },
    { store: STORE_B, isPublished: true, categories: [FOREIGN] },
  ];
  catalogReads = 0;

  const saved = {
    connect: mongooseStub.connect,
    findById: StoreStub.findById,
    distinct: ProductStub.distinct,
    find: CategoryStub.find,
  };

  mongooseStub.connect = async () => mongoose;
  StoreStub.findById = (id) => oneQuery(stores.find((row) => row._id === id) ?? null);
  ProductStub.distinct = async (_field, filter) => {
    catalogReads += 1;
    const live = filter as unknown as { deletedAt?: null; isDemo?: { $ne: boolean } };
    assert.equal(live.deletedAt, null);
    assert.deepEqual(live.isDemo, { $ne: true });
    const matching = products.filter(
      (row) => row.store === filter.store && row.isPublished === filter.isPublished && !row.deletedAt && row.isDemo !== true,
    );
    return [...new Set(matching.flatMap((row) => row.categories))];
  };
  CategoryStub.find = (filter) => {
    catalogReads += 1;
    return rowsQuery(categories.filter((row) => row.store === filter.store && filter._id.$in.includes(row._id)));
  };

  restore = () => {
    mongooseStub.connect = saved.connect;
    StoreStub.findById = saved.findById;
    ProductStub.distinct = saved.distinct;
    CategoryStub.find = saved.find;
  };
});

afterEach(() => restore());

const get = (id: string): Promise<Response> =>
  categoriesGET(new NextRequest('http://localhost/api/storefront/v1/stores/' + id + '/categories'), {
    params: Promise.resolve({ id }),
  });

test('an active store lists its categories by order, in the contract shape, with no session', async () => {
  const res = await get(STORE_A);
  assert.equal(res.status, 200);
  const { data } = storefrontCategoryListResponseSchema.parse(await res.json());
  assert.deepEqual(data, [
    { id: LAWN, name: 'Lawn', slug: 'lawn', order: 1, description: 'Light', bannerUrl: 'https://cdn.test/lawn.jpg' },
    { id: ZARI, name: 'Zari', slug: 'zari', order: 2, description: null, bannerUrl: null },
  ]);
});

test('the answer is public-cacheable and carries no internal field', async () => {
  const res = await get(STORE_A);
  assert.match(res.headers.get('cache-control') ?? '', /public/);
  const body = (await res.json()) as { data: Array<Record<string, unknown>> };
  for (const key of ['store', 'isDemo', 'banner', '_id', 'createdAt']) assert.equal(key in body.data[0], false, key);
});

test('a category with no published product is left out, so a draft stays undiscoverable', async () => {
  const { data } = storefrontCategoryListResponseSchema.parse(await (await get(STORE_A)).json());
  const slugs = data.map((category) => category.slug);
  assert.equal(slugs.includes('empty'), false);
  assert.equal(slugs.includes('coming-soon'), false);
});

test("another store's categories are never returned, even when a product of this store points at one", async () => {
  products.push({ store: STORE_A, isPublished: true, categories: [FOREIGN] });
  const { data } = storefrontCategoryListResponseSchema.parse(await (await get(STORE_A)).json());
  assert.deepEqual(data.map((category) => category.id), [LAWN, ZARI]);

  const other = storefrontCategoryListResponseSchema.parse(await (await get(STORE_B)).json());
  assert.deepEqual(other.data.map((category) => category.id), [FOREIGN]);
});

test('a store with nothing published answers an empty list', async () => {
  products = [];
  const res = await get(STORE_A);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: [] });
});

test('a pending store is refused with 403 STORE_NOT_ACTIVE before the catalog is read', async () => {
  const res = await get(PENDING);
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'STORE_NOT_ACTIVE');
  assert.equal(catalogReads, 0);
});

test('an unknown or malformed store is 404 STORE_NOT_FOUND', async () => {
  for (const id of ['65a0000000000000000000ff', 'nope']) {
    const res = await get(id);
    assert.equal(res.status, 404, id);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'STORE_NOT_FOUND');
  }
  assert.equal(catalogReads, 0);
});

test('a category held only by a demo or a trashed product does not show', async () => {
  products = [
    { store: STORE_A, isPublished: true, isDemo: true, categories: [ZARI] },
    { store: STORE_A, isPublished: true, deletedAt: '2026-10-01T00:00:00.000Z', categories: [LAWN] },
  ];
  const res = await categoriesGET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ id: STORE_A }) });
  assert.deepEqual(((await res.json()) as { data: unknown[] }).data, []);
});
