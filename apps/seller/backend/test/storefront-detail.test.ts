import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Product, Store } from '@/lib/services';
import { storefrontProductDetailResponseSchema } from '@/lib/contracts';

const STORE_ID = '65a000000000000000000011';
const OTHER_STORE_ID = '65a000000000000000000012';

const StoreModel = Store as any;
const ProductModel = Product as any;

let detailGET: (r: NextRequest, c: any) => Promise<Response>;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  detailGET = (await import('../src/app/api/storefront/v1/stores/[id]/products/[slug]/route')).GET;
});

interface Recorded {
  filter?: any;
  projection?: any;
  populates: any[];
  queries: number;
}

let storeRow: Record<string, any> | null;
let products: Array<Record<string, any>>;
let rec: Recorded;
let connectFails: boolean;
let restore: () => void;

/** connectSellerDb caches its first successful connection per process; an outage test has to drop that cache first. */
function simulateOutage(): void {
  const cache = (globalThis as any).__sellerMongo;
  if (cache) cache.promise = null;
}

/** Applies the equality filters the route sends, so an unpublished or foreign product is genuinely not found. */
function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v === null) return (row[k] ?? null) === null;
    if (typeof v === 'object' && '$ne' in v) return row[k] !== v.$ne;
    return String(row[k]) === String(v);
  });
}

beforeEach(() => {
  storeRow = null;
  products = [];
  rec = { populates: [], queries: 0 };
  connectFails = false;

  const saved = { connect: (mongoose as any).connect, sFindById: StoreModel.findById, pFindOne: ProductModel.findOne };
  (mongoose as any).connect = async () => {
    if (connectFails) throw new Error('down');
    return mongoose;
  };
  StoreModel.findById = () => {
    const q: any = { select: () => q, lean: async () => storeRow };
    return q;
  };
  ProductModel.findOne = (filter: any) => {
    rec.filter = filter;
    rec.queries += 1;
    const q: any = {
      select: (p: any) => ((rec.projection = p), q),
      populate: (p: any) => (rec.populates.push(p), q),
      lean: async () => products.find((p) => matches(p, filter)) ?? null,
    };
    return q;
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.findById = saved.sFindById;
    ProductModel.findOne = saved.pFindOne;
  };
});

afterEach(() => restore());

const idCtx = (id: string, slug: string) => ({ params: Promise.resolve({ id, slug }) });
const get = (id: string, slug: string) =>
  detailGET(new NextRequest('http://localhost/api/storefront/v1/stores/' + id + '/products/' + slug), idCtx(id, slug));

function activeStore(sf: Record<string, any> = { deliveryRate: 250 }) {
  return { _id: STORE_ID, status: 'active', storefront: sf, paymentSettings: {} };
}

function product(overrides: Record<string, any> = {}) {
  return {
    _id: '65a0000000000000000000b1',
    store: STORE_ID,
    slug: 'blue-shirt',
    title: 'Blue shirt',
    minPrice: 1500,
    variants: [
      {
        _id: '65a0000000000000000000e1',
        title: 'Default',
        sku: 'SECRET-SKU',
        barcode: 'SECRET-BARCODE',
        price: 1500,
        compareAtPrice: 1800,
        trackQuantity: true,
        stockQuantity: 7,
        lowStockThreshold: null,
        optionValues: [],
        imageId: null,
        position: 0,
      },
    ],
    isPublished: true,
    isDemo: false,
    categories: [{ _id: '65a0000000000000000000c1', slug: 'shirts', name: 'Shirts' }, null],
    media: [
      { _id: 'm1', url: 'https://res.cloudinary.com/demo/a.jpg', alt: 'Front' },
      null,
      { _id: 'm2', url: 'https://res.cloudinary.com/demo/b.jpg', alt: '' },
    ],
    avgRating: 4.5,
    reviewCount: 12,
    description: 'A very blue shirt.',
    highlights: [{ text: 'Cotton' }, { text: '  ' }, { text: 'Machine washable' }],
    tags: ['summer', ''],
    deliveryCharge: null,
    seoTitle: 'Buy the blue shirt',
    seoDescription: null,
    seoImage: { url: 'https://res.cloudinary.com/demo/seo.jpg' },
    ...overrides,
  };
}

test('returns the full detail and it matches the storefront wire schema', async () => {
  storeRow = activeStore();
  products = [product()];
  const res = await get(STORE_ID, 'blue-shirt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /s-maxage/);

  const body = await res.json();
  assert.equal(storefrontProductDetailResponseSchema.safeParse(body).success, true);
  assert.deepEqual(body.data, {
    id: '65a0000000000000000000b1',
    slug: 'blue-shirt',
    title: 'Blue shirt',
    currency: 'PKR',
    price: 1500,
    compareAtPrice: 1800,
    stockStatus: 'in_stock',
    defaultVariantId: '65a0000000000000000000e1',
    hasVariants: false,
    options: [],
    variants: [
      {
        id: '65a0000000000000000000e1',
        title: 'Default',
        price: 1500,
        compareAtPrice: 1800,
        availability: 'in_stock',
        optionValues: [],
        imageId: null,
      },
    ],
    primaryImage: { url: 'https://res.cloudinary.com/demo/a.jpg', alt: 'Front' },
    categories: [{ id: '65a0000000000000000000c1', slug: 'shirts', name: 'Shirts' }],
    avgRating: 4.5,
    reviewCount: 12,
    description: 'A very blue shirt.',
    highlights: ['Cotton', 'Machine washable'],
    // The dangling media entry is dropped; an image with no alt falls back to the title.
    images: [
      { id: 'm1', url: 'https://res.cloudinary.com/demo/a.jpg', alt: 'Front' },
      { id: 'm2', url: 'https://res.cloudinary.com/demo/b.jpg', alt: 'Blue shirt' },
    ],
    videos: [],
    seo: { title: 'Buy the blue shirt', description: null, imageUrl: 'https://res.cloudinary.com/demo/seo.jpg' },
    tags: ['summer'],
    categorySlugs: ['shirts'],
    deliveryCharge: 250,
  });
});

test('the query is store-scoped and published-only, and never selects stock counts or the store', async () => {
  storeRow = activeStore();
  products = [product()];
  await get(STORE_ID, 'blue-shirt');
  assert.deepEqual(rec.filter, { store: STORE_ID, slug: 'blue-shirt', isPublished: true, isDemo: { $ne: true }, deletedAt: null, moderation: null });
  for (const hidden of ['stockQuantity', 'reservedQuantity', 'stockHistory', 'store', 'viewCount', 'lowStockThreshold']) {
    assert.equal(hidden in rec.projection, false, hidden + ' must not be selected');
  }
  const body = JSON.stringify(await (await get(STORE_ID, 'blue-shirt')).json());
  for (const hidden of ['stockQuantity', 'trackQuantity', 'SECRET-SKU', 'SECRET-BARCODE', '"store"']) assert.equal(body.includes(hidden), false, hidden);
});

test("a product's own delivery charge wins over the store rate, and 0 means free", async () => {
  storeRow = activeStore();
  products = [product({ deliveryCharge: 90 })];
  assert.equal((await (await get(STORE_ID, 'blue-shirt')).json()).data.deliveryCharge, 90);
  products = [product({ deliveryCharge: 0 })];
  assert.equal((await (await get(STORE_ID, 'blue-shirt')).json()).data.deliveryCharge, 0);
});

test('videos come back in order, a dangling one is dropped, and a missing poster is null', async () => {
  storeRow = activeStore();
  products = [
    product({
      videos: [
        { _id: 'v2', url: 'https://res.cloudinary.com/demo/video/b.mp4', posterUrl: 'https://res.cloudinary.com/demo/video/b.jpg', duration: 42 },
        null,
        { _id: 'v1', url: 'https://res.cloudinary.com/demo/video/a.mp4' },
      ],
    }),
  ];
  const res = await get(STORE_ID, 'blue-shirt');
  const { data } = storefrontProductDetailResponseSchema.parse(await res.json());
  assert.deepEqual(data.videos, [
    { id: 'v2', url: 'https://res.cloudinary.com/demo/video/b.mp4', posterUrl: 'https://res.cloudinary.com/demo/video/b.jpg', duration: 42 },
    { id: 'v1', url: 'https://res.cloudinary.com/demo/video/a.mp4', posterUrl: null, duration: null },
  ]);
  assert.equal('videos' in rec.projection, true);
});

test('a product with no images and no description still validates', async () => {
  storeRow = activeStore();
  products = [product({ media: [], description: null, highlights: [], tags: [], seoImage: null, seoTitle: null })];
  const res = await get(STORE_ID, 'blue-shirt');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.primaryImage, null);
  assert.deepEqual(data.images, []);
  assert.equal(data.description, null);
  assert.equal(data.seo.imageUrl, null);
});

test('an unknown slug is 404 PRODUCT_NOT_FOUND, uncached', async () => {
  storeRow = activeStore();
  products = [product()];
  const res = await get(STORE_ID, 'no-such-product');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).error.code, 'PRODUCT_NOT_FOUND');
});

test('an unpublished product is indistinguishable from a missing one', async () => {
  storeRow = activeStore();
  products = [product({ isPublished: false })];
  const res = await get(STORE_ID, 'blue-shirt');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'PRODUCT_NOT_FOUND');
});

test('a demo product and a trashed product are not found, and a demo row with no flag at all is still served as not demo', async () => {
  storeRow = activeStore();
  products = [product({ isDemo: true })];
  assert.equal((await get(STORE_ID, 'blue-shirt')).status, 404);
  products = [product({ deletedAt: new Date() })];
  assert.equal((await get(STORE_ID, 'blue-shirt')).status, 404);
  products = [product({ isDemo: undefined })];
  assert.equal((await get(STORE_ID, 'blue-shirt')).status, 200);
});

test('an out-of-stock product set to hide keeps its product page: only lists hide it', async () => {
  storeRow = activeStore();
  const sold = product({ hideWhenOutOfStock: true });
  sold.variants[0].stockQuantity = 0;
  products = [sold];
  const res = await get(STORE_ID, 'blue-shirt');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.stockStatus, 'out_of_stock');
});

test("another store's product is not served under this store", async () => {
  storeRow = activeStore();
  products = [product({ store: OTHER_STORE_ID })];
  assert.equal((await get(STORE_ID, 'blue-shirt')).status, 404);
});

test('the slug is decoded and lowercased before lookup', async () => {
  storeRow = activeStore();
  products = [product()];
  assert.equal((await get(STORE_ID, 'Blue-Shirt')).status, 200);
  assert.equal(rec.filter.slug, 'blue-shirt');
});

test('a slug that cannot be a product is 404 without touching the catalog', async () => {
  storeRow = activeStore();
  products = [product()];
  for (const slug of ['has%20space', 'a%2Fb', '%E0%A4%A', '']) {
    const res = await get(STORE_ID, slug);
    assert.equal(res.status, 404, slug);
    assert.equal((await res.json()).error.code, 'PRODUCT_NOT_FOUND');
  }
  assert.equal(rec.queries, 0);
});

test('a malformed or unknown store id is 404 STORE_NOT_FOUND', async () => {
  const malformed = await get('not-an-id', 'blue-shirt');
  assert.equal(malformed.status, 404);
  assert.equal((await malformed.json()).error.code, 'STORE_NOT_FOUND');

  storeRow = null;
  const unknown = await get(STORE_ID, 'blue-shirt');
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'STORE_NOT_FOUND');
  assert.equal(rec.queries, 0);
});

test('a store that is not active is 403 STORE_NOT_ACTIVE with its status, and serves no product', async () => {
  storeRow = { ...activeStore(), status: 'suspended' };
  products = [product()];
  const res = await get(STORE_ID, 'blue-shirt');
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'STORE_NOT_ACTIVE');
  assert.equal(body.status, 'suspended');
  assert.equal(rec.queries, 0);
});

test('a database outage is 503 STOREFRONT_UNAVAILABLE', async () => {
  simulateOutage();
  connectFails = true;
  const res = await get(STORE_ID, 'blue-shirt');
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'STOREFRONT_UNAVAILABLE');
});
