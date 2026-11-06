import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, test } from 'node:test';
import { SignJWT } from 'jose';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { PREVIEW_AUDIENCE, signPreviewLink } from '@/lib/preview-token';
import { Category, Product, Store } from '@/lib/services';
import { isLiveProduct, liveListFilter, liveProductFilter, previewListFilter, previewProductFilter } from '@/lib/storefront/live-product';

const SECRET = 'preview-test-secret-preview-test-secret';
const HEADER = 'x-markaz-preview';

const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const PENDING = '65a000000000000000000013';
const SUSPENDED = '65a000000000000000000014';

const CAT_LIVE = '65a0000000000000000000c1';
const CAT_DRAFT = '65a0000000000000000000c2';

interface VariantRow {
  _id: string;
  title: string;
  price: number;
  compareAtPrice: null;
  trackQuantity: boolean;
  stockQuantity: number;
  optionValues: string[];
  position: number;
}

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
  categories: string[];
  variants: VariantRow[];
}

interface StoreRow {
  _id: string;
  slug: string;
  name: string;
  status: string;
}

interface CategoryRow {
  _id: string;
  store: string;
  name: string;
  slug: string;
  order: number;
  description: null;
}

type Filter = Record<string, unknown>;

interface StubQuery {
  select: () => StubQuery;
  sort: () => StubQuery;
  skip: () => StubQuery;
  limit: () => StubQuery;
  populate: () => StubQuery;
  lean: () => Promise<unknown>;
}

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const StoreStub = Store as unknown as { findById: (id: string) => StubQuery; findOne: (filter: Filter) => StubQuery };
const ProductStub = Product as unknown as {
  find: (filter: Filter) => StubQuery;
  findOne: (filter: Filter) => StubQuery;
  countDocuments: (filter: Filter) => Promise<number>;
  distinct: (field: string, filter: Filter) => Promise<string[]>;
};
const CategoryStub = Category as unknown as {
  find: (filter: { store: string; _id: { $in: string[] } }) => StubQuery;
  findOne: (filter: Filter) => StubQuery;
};

function query(result: unknown): StubQuery {
  const q: StubQuery = { select: () => q, sort: () => q, skip: () => q, limit: () => q, populate: () => q, lean: async () => result };
  return q;
}

function variant(id: string, stockQuantity: number): VariantRow {
  return { _id: id, title: 'Default', price: 1000, compareAtPrice: null, trackQuantity: true, stockQuantity, optionValues: [], position: 0 };
}

function product(id: string, slug: string, flags: Partial<ProductRow>, store = STORE_A): ProductRow {
  return {
    _id: '65a0000000000000000000' + id,
    store,
    slug,
    title: slug,
    minPrice: 1000,
    isPublished: true,
    isDemo: false,
    hideWhenOutOfStock: false,
    deletedAt: null,
    categories: [],
    variants: [variant('65a0000000000000000000d' + id.charAt(1), 5)],
    ...flags,
  };
}

/** Applies what the two filters can say, so a row the route must not see genuinely is not returned. */
function matches(row: ProductRow, filter: Filter): boolean {
  if (row.store !== filter.store) return false;
  if ('slug' in filter && row.slug !== filter.slug) return false;
  if ('deletedAt' in filter && row.deletedAt !== null) return false;
  if ('isPublished' in filter && row.isPublished !== filter.isPublished) return false;
  if ('isDemo' in filter && row.isDemo) return false;
  if ('$or' in filter && row.hideWhenOutOfStock && !row.variants.some((v) => v.stockQuantity > 0)) return false;
  return true;
}

type Route<P> = (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>;

let listGET: Route<{ id: string }>;
let detailGET: Route<{ id: string; slug: string }>;
let categoriesGET: Route<{ id: string }>;
let byKeyGET: Route<{ key: string }>;
let orderPOST: Route<{ id: string }>;

let stores: StoreRow[];
let products: ProductRow[];
let categories: CategoryRow[];
let databaseReads: number;
let restore: () => void;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  listGET = (await import('../src/app/api/storefront/v1/stores/[id]/products/route')).GET;
  detailGET = (await import('../src/app/api/storefront/v1/stores/[id]/products/[slug]/route')).GET;
  categoriesGET = (await import('../src/app/api/storefront/v1/stores/[id]/categories/route')).GET;
  byKeyGET = (await import('../src/app/api/storefront/v1/stores/by-key/[key]/route')).GET;
  orderPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/route')).POST;
});

beforeEach(() => {
  stores = [
    { _id: STORE_A, slug: 'alpha-store', name: 'Alpha', status: 'active' },
    { _id: STORE_B, slug: 'beta-store', name: 'Beta', status: 'active' },
    { _id: PENDING, slug: 'new-store', name: 'New', status: 'pending' },
    { _id: SUSPENDED, slug: 'held-store', name: 'Held', status: 'suspended' },
  ];
  categories = [
    { _id: CAT_LIVE, store: STORE_A, name: 'Lawn', slug: 'lawn', order: 0, description: null },
    { _id: CAT_DRAFT, store: STORE_A, name: 'Soon', slug: 'soon', order: 1, description: null },
  ];
  products = [
    product('b1', 'live-one', { categories: [CAT_LIVE] }),
    product('b2', 'draft-one', { isPublished: false, categories: [CAT_DRAFT] }),
    product('b3', 'sample-one', { isPublished: false, isDemo: true }),
    product('b4', 'trashed-one', { deletedAt: '2026-10-01T00:00:00.000Z' }),
    product('b5', 'hidden-one', { hideWhenOutOfStock: true, variants: [variant('65a0000000000000000000d5', 0)] }),
    product('b6', 'other-store', {}, STORE_B),
    product('b7', 'pending-draft', { isPublished: false }, PENDING),
  ];
  databaseReads = 0;

  const saved = {
    secret: process.env.PREVIEW_TOKEN_SECRET,
    connect: mongooseStub.connect,
    sFindById: StoreStub.findById,
    sFindOne: StoreStub.findOne,
    pFind: ProductStub.find,
    pFindOne: ProductStub.findOne,
    pCount: ProductStub.countDocuments,
    pDistinct: ProductStub.distinct,
    cFind: CategoryStub.find,
    cFindOne: CategoryStub.findOne,
  };
  process.env.PREVIEW_TOKEN_SECRET = SECRET;
  mongooseStub.connect = async () => mongoose;
  StoreStub.findById = (id) => {
    databaseReads += 1;
    return query(stores.find((row) => row._id === id) ?? null);
  };
  StoreStub.findOne = (filter) => query(stores.find((row) => row.slug === filter.slug) ?? null);
  ProductStub.find = (filter) => query(products.filter((row) => matches(row, filter)));
  ProductStub.findOne = (filter) => query(products.find((row) => matches(row, filter)) ?? null);
  ProductStub.countDocuments = async (filter) => products.filter((row) => matches(row, filter)).length;
  ProductStub.distinct = async (_field, filter) => products.filter((row) => matches(row, filter)).flatMap((row) => row.categories);
  CategoryStub.find = (filter) => query(categories.filter((row) => row.store === filter.store && filter._id.$in.includes(row._id)));
  CategoryStub.findOne = (filter) => query(categories.find((row) => row.slug === filter.slug) ?? null);
  restore = () => {
    if (saved.secret === undefined) delete process.env.PREVIEW_TOKEN_SECRET;
    else process.env.PREVIEW_TOKEN_SECRET = saved.secret;
    mongooseStub.connect = saved.connect;
    StoreStub.findById = saved.sFindById;
    StoreStub.findOne = saved.sFindOne;
    ProductStub.find = saved.pFind;
    ProductStub.findOne = saved.pFindOne;
    ProductStub.countDocuments = saved.pCount;
    ProductStub.distinct = saved.pDistinct;
    CategoryStub.find = saved.cFind;
    CategoryStub.findOne = saved.cFindOne;
  };
});

afterEach(() => restore());

const get = (path: string, token?: string): NextRequest =>
  new NextRequest('http://seller.test/api/storefront/v1/stores/' + path, { headers: token === undefined ? {} : { [HEADER]: token } });

const list = (storeId: string, token?: string): Promise<Response> =>
  listGET(get(storeId + '/products', token), { params: Promise.resolve({ id: storeId }) });

const detail = (storeId: string, slug: string, token?: string): Promise<Response> =>
  detailGET(get(storeId + '/products/' + slug, token), { params: Promise.resolve({ id: storeId, slug }) });

const categoryList = (storeId: string, token?: string): Promise<Response> =>
  categoriesGET(get(storeId + '/categories', token), { params: Promise.resolve({ id: storeId }) });

const byKey = (key: string, token?: string): Promise<Response> =>
  byKeyGET(get('by-key/' + key + '?by=slug', token), { params: Promise.resolve({ key }) });

async function slugs(res: Response): Promise<string[]> {
  const body = (await res.json()) as { data: Array<{ slug: string }> };
  return body.data.map((row) => row.slug).sort();
}

function assertPreviewHeaders(res: Response): void {
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.match(res.headers.get('vary') ?? '', new RegExp(HEADER));
}

function assertLiveHeaders(res: Response): void {
  assert.match(res.headers.get('cache-control') ?? '', /^public/);
  assert.equal(res.headers.get('vary'), null);
}

async function expiredLink(storeId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose: 'preview' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(storeId)
    .setAudience(PREVIEW_AUDIENCE)
    .setJti('expired')
    .setIssuedAt(now - 7200)
    .setExpirationTime(now - 3600)
    .sign(new TextEncoder().encode(SECRET));
}

async function changedLink(storeId: string): Promise<string> {
  const { token } = await signPreviewLink(storeId);
  const [head, body, signature] = token.split('.');
  return `${head}.${body?.slice(0, -2)}xx.${signature}`;
}

const LIVE_SLUGS = ['live-one'];

describe('what is not a good link gets the live store', () => {
  const cases: Array<[string, () => Promise<string | undefined>]> = [
    ['no credential', async () => undefined],
    ['a link for another store', async () => (await signPreviewLink(STORE_B)).token],
    ['an expired link', () => expiredLink(STORE_A)],
    ['a changed link', () => changedLink(STORE_A)],
    ['junk', async () => 'not-a-token'],
  ];

  for (const [name, credential] of cases) {
    test(name + ': list, product page, categories and store are all Live', async () => {
      const token = await credential();

      const listed = await list(STORE_A, token);
      assert.equal(listed.status, 200);
      assertLiveHeaders(listed);
      const body = (await listed.clone().json()) as { data: Array<Record<string, unknown>> };
      assert.ok(body.data.every((row) => !('previewLabel' in row)));
      assert.deepEqual(await slugs(listed), LIVE_SLUGS);

      assert.equal((await detail(STORE_A, 'draft-one', token)).status, 404);
      assert.equal((await detail(STORE_A, 'sample-one', token)).status, 404);

      const held = await categoryList(STORE_A, token);
      assertLiveHeaders(held);
      assert.deepEqual(await slugs(held), ['lawn']);

      const store = await byKey('alpha-store', token);
      assertLiveHeaders(store);
      assert.equal(((await store.json()) as { preview?: boolean }).preview, undefined);
    });
  }

  test('a missing secret turns a good link back into Live', async () => {
    const { token } = await signPreviewLink(STORE_A);
    delete process.env.PREVIEW_TOKEN_SECRET;
    assert.deepEqual(await slugs(await list(STORE_A, token)), LIVE_SLUGS);
  });
});

describe('a good link for this store', () => {
  test('the list shows drafts, the sample and hidden products, never the trash or another store', async () => {
    const { token } = await signPreviewLink(STORE_A);
    const res = await list(STORE_A, token);
    assert.equal(res.status, 200);
    assertPreviewHeaders(res);

    const body = (await res.json()) as { data: Array<{ slug: string; previewLabel: string | null }> };
    const labels = Object.fromEntries(body.data.map((row) => [row.slug, row.previewLabel]));
    assert.deepEqual(labels, {
      'live-one': null,
      'draft-one': 'Draft',
      'sample-one': 'Sample product',
      'hidden-one': null,
    });
  });

  test('the product page opens a draft and the sample, labelled, and a trashed product stays a 404', async () => {
    const { token } = await signPreviewLink(STORE_A);

    const draft = await detail(STORE_A, 'draft-one', token);
    assert.equal(draft.status, 200);
    assertPreviewHeaders(draft);
    assert.equal(((await draft.json()) as { data: { previewLabel: string } }).data.previewLabel, 'Draft');

    const sample = await detail(STORE_A, 'sample-one', token);
    assert.equal(((await sample.json()) as { data: { previewLabel: string } }).data.previewLabel, 'Sample product');

    const trashed = await detail(STORE_A, 'trashed-one', token);
    assert.equal(trashed.status, 404);
    assertPreviewHeaders(trashed);
  });

  test('categories list every category with a previewable product', async () => {
    const { token } = await signPreviewLink(STORE_A);
    const res = await categoryList(STORE_A, token);
    assertPreviewHeaders(res);
    assert.deepEqual(await slugs(res), ['lawn', 'soon']);
  });

  test('the store lookup says preview, and is not cacheable', async () => {
    const { token } = await signPreviewLink(STORE_A);
    const res = await byKey('alpha-store', token);
    assertPreviewHeaders(res);
    const body = (await res.json()) as { preview: boolean; data: { status: string } };
    assert.equal(body.preview, true);
    assert.equal(body.data.status, 'active');
  });
});

describe('store status', () => {
  test('a pending store is unavailable to the public and open to its own preview (A-012)', async () => {
    assert.equal((await list(PENDING)).status, 403);
    const liveLookup = (await (await byKey('new-store')).json()) as { data: Record<string, unknown> };
    assert.deepEqual(liveLookup.data, { status: 'pending' });

    const { token } = await signPreviewLink(PENDING);
    assert.deepEqual(await slugs(await list(PENDING, token)), ['pending-draft']);
    assert.equal((await detail(PENDING, 'pending-draft', token)).status, 200);
    assert.equal((await categoryList(PENDING, token)).status, 200);

    const lookup = (await (await byKey('new-store', token)).json()) as { preview: boolean; data: { status: string; name: string } };
    assert.equal(lookup.preview, true);
    assert.equal(lookup.data.status, 'pending');
    assert.equal(lookup.data.name, 'New');
  });

  test('a link for another store does not open a pending store', async () => {
    const { token } = await signPreviewLink(STORE_A);
    assert.equal((await list(PENDING, token)).status, 403);
    const lookup = (await (await byKey('new-store', token)).json()) as { data: Record<string, unknown>; preview?: boolean };
    assert.deepEqual(lookup.data, { status: 'pending' });
    assert.equal(lookup.preview, undefined);
  });

  test('a suspended store stays unavailable, even with its own good link', async () => {
    const { token } = await signPreviewLink(SUSPENDED);
    const res = await list(SUSPENDED, token);
    assert.equal(res.status, 403);
    assertPreviewHeaders(res);
    const lookup = (await (await byKey('held-store', token)).json()) as { data: Record<string, unknown>; preview?: boolean };
    assert.deepEqual(lookup.data, { status: 'suspended' });
    assert.equal(lookup.preview, undefined);
  });
});

describe('orders', () => {
  const order = (token: string): Promise<Response> =>
    orderPOST(
      new NextRequest('http://seller.test/api/storefront/v1/stores/' + STORE_A + '/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'preview-order-1', [HEADER]: token },
        body: JSON.stringify({ customer: {}, lines: [] }),
      }),
      { params: Promise.resolve({ id: STORE_A }) },
    );

  test('a request with the preview header is refused with 422 before anything is read, good link or not', async () => {
    const { token } = await signPreviewLink(STORE_A);
    for (const credential of [token, 'not-a-token']) {
      const res = await order(credential);
      assert.equal(res.status, 422);
      assertPreviewHeaders(res);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'PREVIEW_ORDER_BLOCKED');
    }
    assert.equal(databaseReads, 0);
  });

  test('checkout still refuses drafts and the sample: the Live guard does not know about preview', () => {
    assert.equal(isLiveProduct({ isPublished: false, isDemo: false, deletedAt: null }), false);
    assert.equal(isLiveProduct({ isPublished: true, isDemo: true, deletedAt: null }), false);
    assert.equal(isLiveProduct({ isPublished: true, isDemo: false, deletedAt: null }), true);
  });
});

test('the Live filters are unchanged, and the preview filters keep the store and the trash rule', () => {
  assert.deepEqual(liveProductFilter(STORE_A), { store: STORE_A, isPublished: true, isDemo: { $ne: true }, deletedAt: null });
  assert.ok('$or' in liveListFilter(STORE_A));
  assert.deepEqual(previewProductFilter(STORE_A), { store: STORE_A, deletedAt: null });
  assert.deepEqual(previewListFilter(STORE_A), { store: STORE_A, deletedAt: null });
});
