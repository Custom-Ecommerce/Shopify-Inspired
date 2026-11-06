import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Category, Media, Product, Store } from '@/lib/services';
import { storefrontProductListResponseSchema, storefrontStoreSchema } from '@/lib/contracts';

const STORE_ID = '65a000000000000000000011';
const LOGO_ID = '65a0000000000000000000a1';
const CAT_ID = '65a0000000000000000000c1';

const StoreModel = Store as any;
const ProductModel = Product as any;
const CategoryModel = Category as any;
const MediaModel = Media as any;

let byKeyGET: (r: NextRequest, c: any) => Promise<Response>;
let productsGET: (r: NextRequest, c: any) => Promise<Response>;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  byKeyGET = (await import('../src/app/api/storefront/v1/stores/by-key/[key]/route')).GET;
  productsGET = (await import('../src/app/api/storefront/v1/stores/[id]/products/route')).GET;
});

interface Calls {
  storeFindOne: any[];
  storeFindById: any[];
  productFind: Array<{ filter: any; projection?: any; sort?: any; skip?: number; limit?: number }>;
  productCount: any[];
  categoryFindOne: any[];
}

let calls: Calls;
let storeRow: Record<string, any> | null;
let productRows: Array<Record<string, any>>;
let productTotal: number;
let categoryRow: Record<string, any> | null;
let restore: () => void;

function chain(result: unknown, record?: (step: string, arg: unknown) => void) {
  const q: any = {};
  for (const step of ['select', 'sort', 'skip', 'limit', 'populate']) {
    q[step] = (arg: unknown) => {
      record?.(step, arg);
      return q;
    };
  }
  q.lean = async () => result;
  return q;
}

beforeEach(() => {
  calls = { storeFindOne: [], storeFindById: [], productFind: [], productCount: [], categoryFindOne: [] };
  storeRow = null;
  productRows = [];
  productTotal = 0;
  categoryRow = null;

  const saved = {
    connect: (mongoose as any).connect,
    sFindOne: StoreModel.findOne,
    sFindById: StoreModel.findById,
    pFind: ProductModel.find,
    pCount: ProductModel.countDocuments,
    cFindOne: CategoryModel.findOne,
    mFindOne: MediaModel.findOne,
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findOne = (filter: any) => {
    calls.storeFindOne.push(filter);
    return chain(storeRow);
  };
  StoreModel.findById = (id: any) => {
    calls.storeFindById.push(id);
    return chain(storeRow);
  };
  ProductModel.countDocuments = async (filter: any) => {
    calls.productCount.push(filter);
    return productTotal;
  };
  ProductModel.find = (filter: any) => {
    const entry: Calls['productFind'][number] = { filter };
    calls.productFind.push(entry);
    return chain(productRows, (step, arg) => {
      if (step === 'select') entry.projection = arg;
      if (step === 'sort') entry.sort = arg;
      if (step === 'skip') entry.skip = arg as number;
      if (step === 'limit') entry.limit = arg as number;
    });
  };
  CategoryModel.findOne = (filter: any) => {
    calls.categoryFindOne.push(filter);
    return chain(categoryRow);
  };
  MediaModel.findOne = () => chain({ url: 'https://res.cloudinary.com/demo/logo.png' });

  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.findOne = saved.sFindOne;
    StoreModel.findById = saved.sFindById;
    ProductModel.find = saved.pFind;
    ProductModel.countDocuments = saved.pCount;
    CategoryModel.findOne = saved.cFindOne;
    MediaModel.findOne = saved.mFindOne;
  };
});

afterEach(() => restore());

const get = (url: string) => new NextRequest('http://localhost' + url);
const keyCtx = (key: string) => ({ params: Promise.resolve({ key }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

function activeStore(overrides: Record<string, any> = {}) {
  return {
    _id: STORE_ID,
    slug: 'acme',
    name: 'Acme',
    internalHandle: 'acme-internal',
    isThemeDemo: false,
    status: 'active',
    storefront: {
      announcementText: 'Free delivery over 5000',
      whatsappNumber: '+923001234567',
      deliveryRate: 250,
      freeDeliveryThreshold: 5000,
      activeTheme: 'mustafa',
      logo: LOGO_ID,
    },
    paymentSettings: { codEnabled: true, cardEnabled: false },
    ...overrides,
  };
}

/* ------------------------------ store resolution ------------------------------ */

test('by-key resolves an active store by slug and matches the contract', async () => {
  storeRow = activeStore();
  const res = await byKeyGET(get('/api/storefront/v1/stores/by-key/Acme?by=slug'), keyCtx('Acme'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(storefrontStoreSchema.safeParse(body.data).success, true);
  assert.equal(body.data.id, STORE_ID);
  assert.equal(body.data.branding.logoUrl, 'https://res.cloudinary.com/demo/logo.png');
  assert.equal(body.data.commerce.deliveryRate, 250);
  assert.equal(body.data.theme.activeTheme, 'mustafa');
  assert.deepEqual(calls.storeFindOne, [{ slug: 'acme' }]);
});

test('by-key by=handle queries internalHandle', async () => {
  storeRow = activeStore();
  await byKeyGET(get('/x?by=handle'), keyCtx('acme-internal'));
  assert.deepEqual(calls.storeFindOne, [{ internalHandle: 'acme-internal' }]);
});

test('by-key resolves only VERIFIED custom domains, and a dotted key is a domain without ?by=', async () => {
  storeRow = activeStore();
  const res = await byKeyGET(get('/x'), keyCtx('Shop.Example.com'));
  assert.equal(res.status, 200);
  assert.deepEqual(calls.storeFindOne, [{ domain: 'shop.example.com', customDomainStatus: 'verified' }]);
});

test('by-key answers 404 STORE_NOT_FOUND for an unknown store', async () => {
  storeRow = null;
  const res = await byKeyGET(get('/x?by=slug'), keyCtx('nope-store'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'STORE_NOT_FOUND');
});

test('by-key never queries for a malformed key', async () => {
  for (const [key, by] of [['a', 'slug'], ['bad key!', 'slug'], ['localhost', 'domain'], ['x'.repeat(65), 'slug']]) {
    const res = await byKeyGET(get('/x?by=' + by), keyCtx(key));
    assert.equal(res.status, 404, key);
  }
  assert.equal(calls.storeFindOne.length, 0);
});

test('by-key rejects an unknown ?by= with 400', async () => {
  const res = await byKeyGET(get('/x?by=owner'), keyCtx('acme'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_REQUEST');
});

test('by-key exposes only the status for a store that is not active', async () => {
  for (const status of ['pending', 'suspended', 'archived']) {
    storeRow = activeStore({ status });
    const res = await byKeyGET(get('/x?by=slug'), keyCtx('acme'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: { status } });
  }
});

test('by-key defaults: COD on, card off, delivery 0, no threshold when the store has no settings', async () => {
  storeRow = activeStore({ storefront: undefined, paymentSettings: undefined });
  const body = await (await byKeyGET(get('/x?by=slug'), keyCtx('acme'))).json();
  assert.equal(body.data.commerce.codEnabled, true);
  assert.equal(body.data.commerce.cardEnabled, false);
  assert.equal(body.data.commerce.deliveryRate, 0);
  assert.equal(body.data.commerce.freeDeliveryThreshold, null);
  assert.equal(body.data.branding.logoUrl, null);
});

/* --------------------------------- catalog --------------------------------- */

const row = (n: number, overrides: Record<string, any> = {}) => ({
  _id: '65a00000000000000000f0' + String(10 + n),
  slug: 'shirt-' + n,
  title: 'Shirt ' + n,
  price: 1000 + n,
  originalPrice: null,
  stockStatus: 'in_stock',
  categories: [{ _id: CAT_ID, slug: 'shirts', name: 'Shirts' }],
  media: [{ url: 'https://res.cloudinary.com/demo/s' + n + '.jpg', alt: 'Shirt photo' }],
  avgRating: 4.5,
  reviewCount: 3,
  ...overrides,
});

test('products returns the page envelope and matches the contract', async () => {
  storeRow = { status: 'active' };
  productRows = [row(1), row(2)];
  productTotal = 50;
  const res = await productsGET(get('/x?limit=10&page=2'), idCtx(STORE_ID));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(storefrontProductListResponseSchema.safeParse(body).success, true);
  assert.equal(body.page, 2);
  assert.equal(body.limit, 10);
  assert.equal(body.totalDocs, 50);
  assert.equal(body.totalPages, 5);
  assert.equal(body.data[0].primaryImage.url, 'https://res.cloudinary.com/demo/s1.jpg');
  assert.deepEqual(body.data[0].categories, [{ id: CAT_ID, slug: 'shirts', name: 'Shirts' }]);
  assert.equal(calls.productFind[0].skip, 10);
  assert.equal(calls.productFind[0].limit, 10);
});

test('products clamps limit to 48 and page to its bounds', async () => {
  storeRow = { status: 'active' };
  for (const [qs, limit, page] of [
    ['limit=1000', 48, 1],
    ['limit=48', 48, 1],
    ['limit=0', 1, 1],
    ['limit=-5', 1, 1],
    ['limit=abc', 24, 1],
    ['', 24, 1],
    ['page=0', 24, 1],
    ['page=99999999', 24, 1000],
  ] as Array<[string, number, number]>) {
    calls.productFind.length = 0;
    const body = await (await productsGET(get('/x?' + qs), idCtx(STORE_ID))).json();
    assert.equal(body.limit, limit, qs);
    assert.equal(body.page, page, qs);
    assert.equal(calls.productFind[0].limit, limit, qs);
    assert.equal(calls.productFind[0].skip, (page - 1) * limit, qs);
  }
});

test('products always scope to the store and to published items, and project media to one entry', async () => {
  storeRow = { status: 'active' };
  await productsGET(get('/x'), idCtx(STORE_ID));
  const call = calls.productFind[0];
  assert.equal(call.filter.store, STORE_ID);
  assert.equal(call.filter.isPublished, true);
  assert.deepEqual(call.projection.media, { $slice: 1 });
  assert.deepEqual(call.sort, { createdAt: -1, _id: -1 });
});

test('products maps each sort to an index-backed order', async () => {
  storeRow = { status: 'active' };
  const expected: Record<string, any> = {
    newest: { createdAt: -1, _id: -1 },
    price_asc: { price: 1, _id: 1 },
    price_desc: { price: -1, _id: -1 },
    rating: { avgRating: -1, reviewCount: -1, _id: -1 },
  };
  for (const [sort, spec] of Object.entries(expected)) {
    calls.productFind.length = 0;
    await productsGET(get('/x?sort=' + sort), idCtx(STORE_ID));
    assert.deepEqual(calls.productFind[0].sort, spec, sort);
  }
});

test('products rejects an unknown sort and a malformed category with 400', async () => {
  storeRow = { status: 'active' };
  for (const qs of ['sort=random', 'category=Bad%20Slug!']) {
    const res = await productsGET(get('/x?' + qs), idCtx(STORE_ID));
    assert.equal(res.status, 400, qs);
    assert.equal((await res.json()).error.code, 'INVALID_REQUEST');
  }
  assert.equal(calls.productFind.length, 0);
});

test('products escapes q and caps it at 80 characters', async () => {
  storeRow = { status: 'active' };
  await productsGET(get('/x?q=' + encodeURIComponent('a.*(b)')), idCtx(STORE_ID));
  assert.equal(calls.productFind[0].filter.title.$regex, 'a\\.\\*\\(b\\)');
  assert.equal(calls.productFind[0].filter.title.$options, 'i');

  calls.productFind.length = 0;
  await productsGET(get('/x?q=' + 'z'.repeat(500)), idCtx(STORE_ID));
  assert.equal(calls.productFind[0].filter.title.$regex.length, 80);
});

test('products filters by category slug, and an unknown category is an empty page without a product query', async () => {
  storeRow = { status: 'active' };
  categoryRow = { _id: CAT_ID };
  await productsGET(get('/x?category=Shirts'), idCtx(STORE_ID));
  assert.deepEqual(calls.categoryFindOne, [{ slug: 'shirts' }]);
  assert.equal(calls.productFind[0].filter.categories, CAT_ID);

  calls.productFind.length = 0;
  calls.productCount.length = 0;
  categoryRow = null;
  const res = await productsGET(get('/x?category=ghosts'), idCtx(STORE_ID));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.totalDocs, 0);
  assert.equal(calls.productFind.length, 0);
  assert.equal(calls.productCount.length, 0);
});

test('products answers 404 for a malformed or unknown store id, without a product query', async () => {
  let res = await productsGET(get('/x'), idCtx('not-an-id'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'STORE_NOT_FOUND');
  assert.equal(calls.storeFindById.length, 0);

  storeRow = null;
  res = await productsGET(get('/x'), idCtx(STORE_ID));
  assert.equal(res.status, 404);
  assert.equal(calls.productFind.length, 0);
});

test('products answers 403 STORE_NOT_ACTIVE with the status for a store that is not serving', async () => {
  storeRow = { status: 'suspended' };
  const res = await productsGET(get('/x'), idCtx(STORE_ID));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'STORE_NOT_ACTIVE');
  assert.equal(body.status, 'suspended');
  assert.equal(calls.productFind.length, 0);
});

test('products drops a deleted category and tolerates a product without images', async () => {
  storeRow = { status: 'active' };
  productRows = [row(1, { categories: [null, { _id: CAT_ID, slug: 'shirts', name: 'Shirts' }], media: [] })];
  productTotal = 1;
  const body = await (await productsGET(get('/x'), idCtx(STORE_ID))).json();
  assert.equal(body.data[0].primaryImage, null);
  assert.equal(body.data[0].categories.length, 1);
});

test('storefront responses are public-cacheable on success and never on errors', async () => {
  storeRow = { status: 'active' };
  const ok = await productsGET(get('/x'), idCtx(STORE_ID));
  assert.match(ok.headers.get('cache-control') ?? '', /s-maxage=30/);
  const bad = await productsGET(get('/x'), idCtx('nope'));
  assert.equal(bad.headers.get('cache-control'), 'no-store');
});

test('storefront routes need no session', async () => {
  storeRow = { status: 'active' };
  const res = await productsGET(get('/x'), idCtx(STORE_ID));
  assert.notEqual(res.status, 401);
});
