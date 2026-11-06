import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { signPreviewLink } from '@/lib/preview-token';
import { Product, Store } from '@/lib/services';

const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const HEADER = 'x-markaz-preview';

interface ProductRow {
  _id: string;
  store: string;
  slug: string;
  title: string;
  minPrice: number;
  isPublished: boolean;
  isDemo: boolean;
  hideWhenOutOfStock: boolean;
  deletedAt: string | null;
  variants: Array<{ _id: string; price: number; compareAtPrice: null; trackQuantity: boolean; stockQuantity: number; position: number }>;
}

type Filter = Record<string, unknown>;

interface StubQuery {
  select: () => StubQuery;
  sort: () => StubQuery;
  skip: () => StubQuery;
  limit: (count: number) => StubQuery;
  populate: () => StubQuery;
  lean: () => Promise<unknown>;
}

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const StoreStub = Store as unknown as { findById: (id: string) => StubQuery };
const ProductStub = Product as unknown as {
  find: (filter: Filter) => StubQuery;
  countDocuments: (filter: Filter) => Promise<number>;
};

const id = (n: number): string => '65a0000000000000000' + String(10000 + n);

function product(n: number, flags: Partial<ProductRow> = {}, stock = 5): ProductRow {
  return {
    _id: id(n),
    store: STORE_A,
    slug: 'p' + n,
    title: 'P' + n,
    minPrice: 1000,
    isPublished: true,
    isDemo: false,
    hideWhenOutOfStock: false,
    deletedAt: null,
    variants: [{ _id: '65a0000000000000000' + String(20000 + n), price: 1000, compareAtPrice: null, trackQuantity: true, stockQuantity: stock, position: 0 }],
    ...flags,
  };
}

function matches(row: ProductRow, filter: Filter): boolean {
  if (row.store !== filter.store) return false;
  if ('deletedAt' in filter && row.deletedAt !== null) return false;
  if ('isPublished' in filter && row.isPublished !== filter.isPublished) return false;
  if ('isDemo' in filter && row.isDemo) return false;
  if ('$or' in filter && row.hideWhenOutOfStock && !row.variants.some((variant) => variant.stockQuantity > 0)) return false;
  if ('_id' in filter && !(filter._id as { $in: string[] }).$in.includes(row._id)) return false;
  return true;
}

let GET: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let products: ProductRow[];
let lastFilter: Filter | null;
let lastLimit: number | null;
let restore: () => void;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  GET = (await import('../src/app/api/storefront/v1/stores/[id]/products/route')).GET;
});

beforeEach(() => {
  products = [
    product(1),
    product(2, {}, 0),
    product(3, { isPublished: false }),
    product(4, { isPublished: false, isDemo: true }),
    product(5, { deletedAt: '2026-10-01T00:00:00.000Z' }),
    product(6, { hideWhenOutOfStock: true }, 0),
    product(7, { store: STORE_B }),
  ];
  lastFilter = null;
  lastLimit = null;

  const saved = { connect: mongooseStub.connect, findById: StoreStub.findById, find: ProductStub.find, count: ProductStub.countDocuments, secret: process.env.PREVIEW_TOKEN_SECRET };
  process.env.PREVIEW_TOKEN_SECRET = 'preview-test-secret-preview-test-secret';
  mongooseStub.connect = async () => mongoose;
  const storeQuery = (row: object | null): StubQuery => {
    const q: StubQuery = { select: () => q, sort: () => q, skip: () => q, limit: () => q, populate: () => q, lean: async () => row };
    return q;
  };
  StoreStub.findById = (storeId) => storeQuery({ _id: storeId, status: 'active' });
  ProductStub.find = (filter) => {
    lastFilter = filter;
    const q: StubQuery = {
      select: () => q,
      sort: () => q,
      skip: () => q,
      limit: (count) => {
        lastLimit = count;
        return q;
      },
      populate: () => q,
      lean: async () => products.filter((row) => matches(row, filter)),
    };
    return q;
  };
  ProductStub.countDocuments = async (filter) => products.filter((row) => matches(row, filter)).length;
  restore = () => {
    mongooseStub.connect = saved.connect;
    StoreStub.findById = saved.findById;
    ProductStub.find = saved.find;
    ProductStub.countDocuments = saved.count;
    if (saved.secret === undefined) delete process.env.PREVIEW_TOKEN_SECRET;
    else process.env.PREVIEW_TOKEN_SECRET = saved.secret;
  };
});

afterEach(() => restore());

const get = (query: string, headers: Record<string, string> = {}): Promise<Response> =>
  GET(new NextRequest('http://seller.test/api/storefront/v1/stores/' + STORE_A + '/products' + query, { headers }), { params: Promise.resolve({ id: STORE_A }) });

async function slugs(res: Response): Promise<string[]> {
  const body = (await res.json()) as { data: Array<{ slug: string }> };
  return body.data.map((row) => row.slug).sort();
}

test('ids returns only Live products of this store; an out-of-stock product the seller did not hide stays', async () => {
  const all = [1, 2, 3, 4, 5, 6, 7].map(id).join(',');
  const res = await get('?ids=' + all);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /^public/);
  const body = (await res.clone().json()) as { data: Array<{ slug: string; stockStatus: string }>; totalDocs: number };
  assert.deepEqual(body.data.map((row) => row.slug).sort(), ['p1', 'p2']);
  assert.equal(body.data.find((row) => row.slug === 'p2')?.stockStatus, 'out_of_stock');
  assert.equal(body.totalDocs, 2);
});

test('invalid ids are ignored, and repeats count once', async () => {
  assert.deepEqual(await slugs(await get('?ids=nope,' + id(1) + ',123,' + id(1).toUpperCase())), ['p1']);
  assert.deepEqual((lastFilter?._id as { $in: string[] }).$in, [id(1)]);
});

test('nothing valid means nothing at all, never the whole catalogue', async () => {
  assert.deepEqual(await slugs(await get('?ids=nope')), []);
  assert.deepEqual(await slugs(await get('?ids=')), []);
  assert.equal(lastFilter, null);
});

test('at most 48 ids are read, and all of them fit on one page', async () => {
  const many = Array.from({ length: 60 }, (_, index) => id(100 + index));
  await get('?limit=2&page=9&ids=' + many.join(','));
  assert.equal((lastFilter?._id as { $in: string[] }).$in.length, 48);
  assert.equal(lastLimit, 48);
});

test('ids stays Live even with a good preview link, because the answer decides what is pruned', async () => {
  const { token } = await signPreviewLink(STORE_A);
  const res = await get('?ids=' + [1, 3].map(id).join(','), { [HEADER]: token });
  assert.match(res.headers.get('cache-control') ?? '', /^public/);
  assert.deepEqual(await slugs(res), ['p1']);
});

test('without ids the route behaves as before', async () => {
  const res = await get('');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /^public/);
  assert.deepEqual(await slugs(res), ['p1', 'p2']);
  assert.equal(lastFilter !== null && '_id' in lastFilter, false);
  assert.equal(lastLimit, 24);
});
