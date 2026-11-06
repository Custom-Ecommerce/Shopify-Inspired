import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Category, Media, Product, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

const SECRET = 'x'.repeat(40);

const SELLER_A = '65a000000000000000000001';
const SELLER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const CAT_A = '65a0000000000000000000c1';
const CAT_B = '65a0000000000000000000c2';
const MEDIA_A = '65a0000000000000000000e1';
const MEDIA_B = '65a0000000000000000000e2';
const PRODUCT_A = '65a0000000000000000000b1';
const PRODUCT_B = '65a0000000000000000000b2';
const DEMO_A = '65a0000000000000000000b3';
const SIZED_A = '65a0000000000000000000b4';
const VARIANT_A = '65a0000000000000000000d1';
const VARIANT_B = '65a0000000000000000000d2';
const VARIANT_DEMO = '65a0000000000000000000d3';
const VARIANT_S = '65a0000000000000000000d4';
const VARIANT_M = '65a0000000000000000000d5';
const NOW = '2026-10-01T00:00:00.000Z';

type Doc = Record<string, unknown>;

interface VariantRow extends Doc {
  _id: unknown;
  title: string;
  sku: string | null;
  price: number;
  compareAtPrice: number | null;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold: number | null;
  optionValues: string[];
  position: number;
}

interface ProductRow extends Doc {
  _id: string;
  store: string;
  title: string;
  slug: string;
  isPublished: boolean;
  isDemo: boolean;
  categories: string[];
  media: string[];
  options: Array<{ name: string; values: string[] }>;
  variants: VariantRow[];
  minPrice: number;
}

interface StubQuery {
  select: () => StubQuery;
  sort: () => StubQuery;
  skip: () => StubQuery;
  limit: () => StubQuery;
  populate: () => StubQuery;
  lean: () => Promise<unknown>;
}

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const ProductStub = Product as unknown as {
  find: (filter: Doc) => StubQuery;
  findOne: (filter: Doc) => StubQuery;
  findOneAndUpdate: (filter: Doc, update: Array<{ $set: Doc }>) => StubQuery;
  countDocuments: (filter: Doc) => Promise<number>;
  exists: (filter: Doc) => Promise<unknown>;
  create: (doc: Doc) => Promise<Doc>;
  deleteOne: (filter: Doc) => Promise<unknown>;
};
const CategoryStub = Category as unknown as {
  countDocuments: (filter: { store: string; _id: { $in: string[] } }) => Promise<number>;
  findOne: (filter: Doc) => StubQuery;
};
const MediaStub = Media as unknown as { countDocuments: (filter: { store: string; _id: { $in: string[] } }) => Promise<number> };
const StoreStub = Store as unknown as {
  exists: (filter: Doc) => Promise<unknown>;
  findOne: (filter: Doc) => StubQuery;
  findById: (id: string) => StubQuery;
};

type RouteContext = { params: Promise<{ id: string }> };
type CollectionHandler = (request: NextRequest) => Promise<Response>;
type ItemHandler = (request: NextRequest, context: RouteContext) => Promise<Response>;
type LiveListHandler = (request: NextRequest, context: RouteContext) => Promise<Response>;

let listGET: CollectionHandler;
let createPOST: CollectionHandler;
let itemGET: ItemHandler;
let itemPATCH: ItemHandler;
let itemDELETE: ItemHandler;
let liveListGET: LiveListHandler;

let tokenA = '';
let tokenB = '';
let adminToken = '';

let products: ProductRow[];
let writes: number;
/** Runs after the route's read and before its write: the moment a shopper's order can land. */
let betweenReadAndWrite: () => void;
let restore: () => void;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: SELLER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: SELLER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  adminToken = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  const collection = await import('../src/app/api/products/route');
  const item = await import('../src/app/api/products/[id]/route');
  const live = await import('../src/app/api/storefront/v1/stores/[id]/products/route');
  listGET = collection.GET;
  createPOST = collection.POST;
  itemGET = item.GET;
  itemPATCH = item.PATCH;
  itemDELETE = item.DELETE;
  liveListGET = live.GET;
});

function matches(row: ProductRow, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === 'variants._id') {
      return (value as { $all: unknown[] }).$all.every((id) => row.variants.some((variant) => String(variant._id) === String(id)));
    }
    if (key === 'variants.sku') {
      return row.variants.some((variant) => variant.sku !== null && (value as { $in: string[] }).$in.includes(variant.sku));
    }
    if (key === '_id' && typeof value === 'object' && value !== null) return row._id !== String((value as { $ne: unknown }).$ne);
    return String(row[key]) === String(value);
  });
}

/** What .populate().lean() gives: a copy, with the relations as documents. */
const leaned = (row: ProductRow): Doc => ({
  ...structuredClone(row),
  categories: row.categories.map((id) => ({ _id: id, name: 'Lawn', slug: 'lawn' })),
  media: row.media.map((id) => ({ _id: id, url: 'https://cdn.test/' + id + '.jpg', alt: null })),
});

function query(rows: ProductRow[], single: boolean): StubQuery {
  const q: StubQuery = {
    select: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    populate: () => q,
    lean: async () => (single ? (rows[0] ? leaned(rows[0]) : null) : rows.map(leaned)),
  };
  return q;
}

/** The expressions a product PATCH uses, evaluated as the database would, against the stored document. */
function evaluate(expression: unknown, doc: Doc, vars: Doc = {}): unknown {
  if (typeof expression === 'string') {
    if (expression.startsWith('$$')) {
      const [name, ...path] = expression.slice(2).split('.');
      return path.reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], vars[name]);
    }
    return expression.startsWith('$') ? doc[expression.slice(1)] : expression;
  }
  if (Array.isArray(expression)) return expression.map((entry) => evaluate(entry, doc, vars));
  if (typeof expression !== 'object' || expression === null) return expression;

  const op = expression as Doc;
  if ('$literal' in op) return op.$literal;
  if ('$mergeObjects' in op) return Object.assign({}, ...(evaluate(op.$mergeObjects, doc, vars) as Doc[]));
  if ('$arrayElemAt' in op) {
    const [list, index] = evaluate(op.$arrayElemAt, doc, vars) as [unknown[], number];
    return list[index];
  }
  if ('$eq' in op) {
    const [left, right] = evaluate(op.$eq, doc, vars) as [unknown, unknown];
    return String(left) === String(right);
  }
  if ('$filter' in op) {
    const { input, as, cond } = op.$filter as { input: unknown; as: string; cond: unknown };
    return (evaluate(input, doc, vars) as unknown[]).filter((entry) => evaluate(cond, doc, { ...vars, [as]: entry }));
  }
  if ('$let' in op) {
    const spec = op.$let as { vars: Doc; in: unknown };
    const bound = Object.fromEntries(Object.entries(spec.vars).map(([name, value]) => [name, evaluate(value, doc, vars)]));
    return evaluate(spec.in, doc, { ...vars, ...bound });
  }
  return Object.fromEntries(Object.entries(op).map(([key, value]) => [key, evaluate(value, doc, vars)]));
}

const variant = (id: string, overrides: Partial<VariantRow> = {}): VariantRow => ({
  _id: id,
  title: 'Default',
  sku: null,
  barcode: null,
  price: 1000,
  compareAtPrice: null,
  trackQuantity: true,
  stockQuantity: 7,
  lowStockThreshold: null,
  optionValues: [],
  imageId: null,
  position: 0,
  ...overrides,
});

const product = (id: string, store: string, variants: VariantRow[], overrides: Partial<ProductRow> = {}): ProductRow => ({
  _id: id,
  store,
  title: 'Kurta ' + id.slice(-2),
  slug: 'kurta-' + id.slice(-2),
  isPublished: false,
  isDemo: false,
  isFeatured: false,
  categories: [store === STORE_A ? CAT_A : CAT_B],
  media: [],
  options: [],
  variants,
  minPrice: Math.min(...variants.map((v) => v.price)),
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const ownedCount = (ids: string[], store: string, owner: Record<string, string>): number =>
  ids.filter((id) => owner[id] === store).length;

beforeEach(() => {
  products = [
    product(PRODUCT_A, STORE_A, [variant(VARIANT_A)]),
    product(PRODUCT_B, STORE_B, [variant(VARIANT_B)]),
    product(DEMO_A, STORE_A, [variant(VARIANT_DEMO)], { isDemo: true }),
    product(
      SIZED_A,
      STORE_A,
      [
        variant(VARIANT_S, { title: 'S', optionValues: ['S'], price: 900, stockQuantity: 3 }),
        variant(VARIANT_M, { title: 'M', optionValues: ['M'], price: 1100, stockQuantity: 0, position: 1 }),
      ],
      { options: [{ name: 'Size', values: ['S', 'M', 'L'] }] },
    ),
  ];
  writes = 0;
  betweenReadAndWrite = () => {};

  const saved = {
    connect: mongooseStub.connect,
    find: ProductStub.find,
    findOne: ProductStub.findOne,
    update: ProductStub.findOneAndUpdate,
    count: ProductStub.countDocuments,
    exists: ProductStub.exists,
    create: ProductStub.create,
    remove: ProductStub.deleteOne,
    categoryCount: CategoryStub.countDocuments,
    categoryFindOne: CategoryStub.findOne,
    mediaCount: MediaStub.countDocuments,
    storeExists: StoreStub.exists,
    storeFindOne: StoreStub.findOne,
    storeFindById: StoreStub.findById,
  };

  mongooseStub.connect = async () => mongoose;
  ProductStub.find = (filter) => query(products.filter((row) => matches(row, filter)), false);
  ProductStub.findOne = (filter) => query(products.filter((row) => matches(row, filter)), true);
  ProductStub.countDocuments = async (filter) => products.filter((row) => matches(row, filter)).length;
  ProductStub.exists = async (filter) => (products.some((row) => matches(row, filter)) ? { _id: 'x' } : null);
  ProductStub.create = async (doc) => {
    if (products.some((row) => row.store === doc.store && row.slug === doc.slug)) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    }
    const variants = (doc.variants as VariantRow[]).map((row, index) => ({ ...row, _id: '65a0000000000000000000f' + index }));
    const row = { ...doc, _id: '65a0000000000000000000a1', variants, createdAt: NOW, updatedAt: NOW } as unknown as ProductRow;
    products.push(row);
    return row;
  };
  ProductStub.findOneAndUpdate = (filter, update) => {
    betweenReadAndWrite();
    writes += 1;
    const row = products.find((candidate) => matches(candidate, filter));
    if (row) {
      const stored = { ...row };
      for (const stage of update) {
        for (const [field, value] of Object.entries(stage.$set)) (row as Doc)[field] = evaluate(value, stored);
      }
    }
    return query(row ? [row] : [], true);
  };
  ProductStub.deleteOne = async (filter) => {
    products = products.filter((row) => !matches(row, filter));
    return { deletedCount: 1 };
  };
  CategoryStub.countDocuments = async (filter) =>
    ownedCount(filter._id.$in, filter.store, { [CAT_A]: STORE_A, [CAT_B]: STORE_B });
  CategoryStub.findOne = () => ({ select: () => CategoryStub.findOne({}), lean: async () => null }) as unknown as StubQuery;
  MediaStub.countDocuments = async (filter) =>
    ownedCount(filter._id.$in, filter.store, { [MEDIA_A]: STORE_A, [MEDIA_B]: STORE_B });
  StoreStub.exists = async (filter) => {
    const owners: Record<string, string> = { [STORE_A]: SELLER_A, [STORE_B]: SELLER_B };
    return owners[String(filter._id)] === String(filter.owner) ? { _id: filter._id } : null;
  };
  StoreStub.findOne = (filter) => {
    const id = String(filter.owner) === SELLER_B ? STORE_B : STORE_A;
    const q = { select: () => q, sort: () => q, lean: async () => ({ _id: id }) };
    return q as unknown as StubQuery;
  };
  StoreStub.findById = () => {
    const q = { select: () => q, lean: async () => ({ status: 'active' }) };
    return q as unknown as StubQuery;
  };

  restore = () => {
    mongooseStub.connect = saved.connect;
    ProductStub.find = saved.find;
    ProductStub.findOne = saved.findOne;
    ProductStub.findOneAndUpdate = saved.update;
    ProductStub.countDocuments = saved.count;
    ProductStub.exists = saved.exists;
    ProductStub.create = saved.create;
    ProductStub.deleteOne = saved.remove;
    CategoryStub.countDocuments = saved.categoryCount;
    CategoryStub.findOne = saved.categoryFindOne;
    MediaStub.countDocuments = saved.mediaCount;
    StoreStub.exists = saved.storeExists;
    StoreStub.findOne = saved.storeFindOne;
    StoreStub.findById = saved.storeFindById;
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
  const headers: Record<string, string> = {
    authorization: 'Bearer ' + (call.token ?? tokenA),
    'x-store-id': call.storeHeader ?? STORE_A,
  };
  if (call.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest('http://seller.test' + path + (call.query ?? ''), {
    method,
    headers,
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
  });
}

const ctx = (id: string): RouteContext => ({ params: Promise.resolve({ id }) });
const row = (id: string): ProductRow => {
  const found = products.find((candidate) => candidate._id === id);
  assert.ok(found);
  return found;
};
const errorCode = async (res: Response): Promise<unknown> => ((await res.json()) as { errors: Array<{ code?: unknown }> }).errors[0].code;
const patch = (id: string, body: unknown, call: Call = {}): Promise<Response> =>
  itemPATCH(request('PATCH', '/api/products/' + id, { ...call, body }), ctx(id));
const create = (body: unknown, call: Call = {}): Promise<Response> => createPOST(request('POST', '/api/products', { ...call, body }));

const validCreate = { title: 'Blue Lawn Suit', categories: [CAT_A], price: 2500.4, stockQuantity: 5 };

test('every product route needs a session; the old open GET by id is gone', async () => {
  const anonymous = new NextRequest('http://seller.test/api/products');
  assert.equal((await listGET(anonymous)).status, 401);
  assert.equal((await itemGET(anonymous, ctx(PRODUCT_A))).status, 401);
});

test('the list shows only the seller\'s store, with derived stock and a demo marker', async () => {
  const res = await listGET(request('GET', '/api/products'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { docs: Array<Doc>; totalDocs: number; hasDemoProduct: boolean };
  assert.equal(body.totalDocs, 3);
  assert.equal(body.hasDemoProduct, true);
  assert.ok(!body.docs.some((doc) => doc.id === PRODUCT_B));

  const sized = body.docs.find((doc) => doc.id === SIZED_A);
  assert.equal(sized?.stockStatus, 'in_stock');
  assert.equal(sized?.totalStock, 3);
  assert.equal(sized?.variantCount, 2);
  assert.equal(sized?.minPrice, 900);
  assert.equal(sized?.status, 'draft');
});

test('the list refuses an unknown status or sort', async () => {
  assert.equal((await listGET(request('GET', '/api/products', { query: '?status=trash' }))).status, 422);
  assert.equal((await listGET(request('GET', '/api/products', { query: '?sort=stockQuantity' }))).status, 422);
});

test('a seller cannot read, change or delete a product of another store: 404, and nothing is written', async () => {
  assert.equal((await itemGET(request('GET', '/api/products/' + PRODUCT_B), ctx(PRODUCT_B))).status, 404);
  assert.equal((await patch(PRODUCT_B, { title: 'Stolen' })).status, 404);
  assert.equal((await itemDELETE(request('DELETE', '/api/products/' + PRODUCT_B), ctx(PRODUCT_B))).status, 404);
  assert.equal(writes, 0);
  assert.equal(row(PRODUCT_B).title, 'Kurta b2');
});

test('naming another seller\'s store is refused with 403', async () => {
  assert.equal((await listGET(request('GET', '/api/products', { storeHeader: STORE_B }))).status, 403);
  assert.equal((await itemGET(request('GET', '/api/products/' + PRODUCT_B, { storeHeader: STORE_B }), ctx(PRODUCT_B))).status, 403);
});

test('the owner reads one product with its variants and their availability', async () => {
  const res = await itemGET(request('GET', '/api/products/' + SIZED_A), ctx(SIZED_A));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { options: unknown[]; variants: Array<{ id: string; availability: string }> };
  assert.equal(body.options.length, 1);
  assert.deepEqual(body.variants.map((v) => [v.id, v.availability]), [[VARIANT_S, 'in_stock'], [VARIANT_M, 'out_of_stock']]);
});

test('an admin may read but not write', async () => {
  assert.equal((await itemGET(request('GET', '/api/products/' + PRODUCT_A, { token: adminToken }), ctx(PRODUCT_A))).status, 200);
  assert.equal((await create(validCreate, { token: adminToken })).status, 403);
  assert.equal((await patch(PRODUCT_A, { title: 'X' }, { token: adminToken })).status, 403);
  assert.equal((await itemDELETE(request('DELETE', '/api/products/' + DEMO_A, { token: adminToken }), ctx(DEMO_A))).status, 403);
});

test('create makes a draft in the owned store with a Default variant, a slug from the title and a rounded price', async () => {
  const res = await create(validCreate);
  assert.equal(res.status, 201);
  const body = (await res.json()) as { slug: string; status: string; minPrice: number; variants: Array<{ title: string; stockQuantity: number }> };
  assert.equal(body.slug, 'blue-lawn-suit');
  assert.equal(body.status, 'draft');
  assert.equal(body.minPrice, 2500);
  assert.deepEqual(body.variants.map((v) => [v.title, v.stockQuantity]), [['Default', 5]]);
  assert.equal(products.at(-1)?.store, STORE_A);
  assert.equal(products.at(-1)?.isPublished, false);
});

test('create refuses a store in the body, and every other field it does not know', async () => {
  assert.equal((await create({ ...validCreate, store: STORE_B })).status, 422);
  assert.equal((await create({ ...validCreate, storeId: STORE_B })).status, 422);
  assert.equal((await create({ ...validCreate, isPublished: true })).status, 422);
  assert.equal((await create({ ...validCreate, isDemo: true })).status, 422);
});

test('create needs a category, and every category must be of this store', async () => {
  assert.equal((await create({ title: 'X', price: 1 })).status, 422);
  assert.equal((await create({ title: 'X', price: 1, categories: [] })).status, 422);
  const foreign = await create({ ...validCreate, categories: [CAT_A, CAT_B] });
  assert.equal(foreign.status, 422);
  assert.equal(await errorCode(foreign), 'PRODUCT_CATEGORY_INVALID');
});

test('an image of another store is refused', async () => {
  const res = await create({ ...validCreate, media: [MEDIA_B] });
  assert.equal(res.status, 422);
  assert.equal(await errorCode(res), 'PRODUCT_MEDIA_INVALID');
  assert.equal((await create({ ...validCreate, media: [MEDIA_A] })).status, 201);
});

test('slug rules: taken in the store is 409, an Urdu title needs a manual slug', async () => {
  const taken = await create({ ...validCreate, slug: 'kurta-b1' });
  assert.equal(taken.status, 409);
  assert.equal(await errorCode(taken), 'PRODUCT_SLUG_TAKEN');

  const urdu = await create({ ...validCreate, title: 'لان کا سوٹ' });
  assert.equal(urdu.status, 422);
  assert.equal(await errorCode(urdu), 'PRODUCT_SLUG_REQUIRED');
  assert.equal((await create({ ...validCreate, title: 'لان کا سوٹ', slug: 'lawn-suit' })).status, 201);

  assert.equal((await create({ ...validCreate, slug: 'kurta-b2' })).status, 201, 'another store holds this slug');
});

test('the description is plain text: line breaks stay, HTML is refused, the cap is 5000', async () => {
  assert.equal((await create({ ...validCreate, description: 'Line one\nLine two, 3 < 5' })).status, 201);
  assert.match(String(products.at(-1)?.description), /Line one\nLine two/);
  assert.equal((await create({ ...validCreate, slug: 'a', description: 'Soft <b>lawn</b>' })).status, 422);
  assert.equal((await create({ ...validCreate, slug: 'b', description: 'x'.repeat(5001) })).status, 422);
  assert.equal((await patch(PRODUCT_A, { description: '<script>alert(1)</script>' })).status, 422);
});

test('highlights are at most 10 plain strings of 200 characters', async () => {
  assert.equal((await create({ ...validCreate, highlights: Array.from({ length: 11 }, () => 'x') })).status, 422);
  assert.equal((await create({ ...validCreate, highlights: ['y'.repeat(201)] })).status, 422);
  assert.equal((await create({ ...validCreate, highlights: ['<i>x</i>'] })).status, 422);
});

test('a patch changes only what was sent, and a new title keeps the slug', async () => {
  const res = await patch(PRODUCT_A, { title: 'Renamed $100 off' });
  assert.equal(res.status, 200);
  assert.equal(row(PRODUCT_A).title, 'Renamed $100 off');
  assert.equal(row(PRODUCT_A).slug, 'kurta-b1');
  assert.equal(row(PRODUCT_A).variants[0].stockQuantity, 7);
});

test('a patch cannot move a product, publish it or empty its categories', async () => {
  assert.equal((await patch(PRODUCT_A, { store: STORE_B })).status, 422);
  assert.equal((await patch(PRODUCT_A, { isPublished: true })).status, 422);
  assert.equal((await patch(PRODUCT_A, { categories: [] })).status, 422);
  const foreign = await patch(PRODUCT_A, { categories: [CAT_B] });
  assert.equal(foreign.status, 422);
  assert.equal(await errorCode(foreign), 'PRODUCT_CATEGORY_INVALID');
  assert.equal(writes, 0);
});

test('D-034: a changed stockQuantity on an existing variant is refused with STOCK_VIA_INVENTORY', async () => {
  const res = await patch(PRODUCT_A, { variants: [{ id: VARIANT_A, stockQuantity: 99 }] });
  assert.equal(res.status, 422);
  assert.equal(await errorCode(res), 'STOCK_VIA_INVENTORY');
  assert.equal(writes, 0);
  assert.equal(row(PRODUCT_A).variants[0].stockQuantity, 7);
});

test('D-034: repeating the unchanged stock is fine', async () => {
  const res = await patch(PRODUCT_A, { variants: [{ id: VARIANT_A, stockQuantity: 7, price: 1200.6 }] });
  assert.equal(res.status, 200);
  assert.equal(row(PRODUCT_A).variants[0].price, 1201);
  assert.equal(row(PRODUCT_A).minPrice, 1201);
});

test('D-034: an order that lands between the read and the write keeps its decrement', async () => {
  betweenReadAndWrite = () => {
    row(PRODUCT_A).variants[0].stockQuantity -= 2;
  };
  const res = await patch(PRODUCT_A, { variants: [{ id: VARIANT_A, price: 1300 }] });
  assert.equal(res.status, 200);
  assert.equal(row(PRODUCT_A).variants[0].price, 1300);
  assert.equal(row(PRODUCT_A).variants[0].stockQuantity, 5);
});

test('a patch keeps every field of a variant it does not name, and a new variant brings its own stock', async () => {
  const res = await patch(SIZED_A, {
    variants: [
      { id: VARIANT_S },
      { id: VARIANT_M, price: 800 },
      { optionValues: ['L'], price: 1500, stockQuantity: 4 },
    ],
  });
  assert.equal(res.status, 200);
  const variants = row(SIZED_A).variants;
  assert.deepEqual(variants.map((v) => [v.title, v.price, v.stockQuantity, v.position]), [
    ['S', 900, 3, 0],
    ['M', 800, 0, 1],
    ['L', 1500, 4, 2],
  ]);
  assert.equal(row(SIZED_A).minPrice, 800);
  assert.ok(variants[2]._id, 'the new variant has an id');
});

test('a patch naming a variant of another product is refused', async () => {
  const res = await patch(PRODUCT_A, { variants: [{ id: VARIANT_B, price: 1 }] });
  assert.equal(res.status, 422);
  assert.equal(await errorCode(res), 'INVALID_VARIANTS');
});

test('a variant removed by another edit in the meantime is a 409, not a variant with no stock', async () => {
  betweenReadAndWrite = () => {
    row(SIZED_A).variants = row(SIZED_A).variants.filter((v) => v._id !== VARIANT_M);
  };
  const res = await patch(SIZED_A, { variants: [{ id: VARIANT_S }, { id: VARIANT_M, price: 800 }] });
  assert.equal(res.status, 409);
  assert.equal(await errorCode(res), 'PRODUCT_CHANGED');
});

test('the first edit makes a demo product the seller\'s own', async () => {
  assert.equal((await patch(DEMO_A, { title: 'My first kurta' })).status, 200);
  assert.equal(row(DEMO_A).isDemo, false);
  assert.equal(row(DEMO_A).isPublished, false);
});

test('delete: a demo product goes for good, any other product answers 501', async () => {
  const refused = await itemDELETE(request('DELETE', '/api/products/' + PRODUCT_A), ctx(PRODUCT_A));
  assert.equal(refused.status, 501);
  assert.equal(await errorCode(refused), 'PRODUCT_DELETE_NOT_AVAILABLE');
  assert.ok(row(PRODUCT_A));

  assert.equal((await itemDELETE(request('DELETE', '/api/products/' + DEMO_A), ctx(DEMO_A))).status, 200);
  assert.ok(!products.some((candidate) => candidate._id === DEMO_A));
});

test('Live never lists a demo product, even a published one, while the seller\'s list does', async () => {
  row(DEMO_A).isPublished = true;
  row(PRODUCT_A).isPublished = true;

  const res = await liveListGET(new NextRequest('http://seller.test/api/storefront/v1/stores/' + STORE_A + '/products'), ctx(STORE_A));
  assert.equal(res.status, 200);
  const live = (await res.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(live.data.map((item) => item.id), [PRODUCT_A]);

  const seller = (await (await listGET(request('GET', '/api/products'))).json()) as { docs: Array<{ id: string }> };
  assert.ok(seller.docs.some((doc) => doc.id === DEMO_A));
});
