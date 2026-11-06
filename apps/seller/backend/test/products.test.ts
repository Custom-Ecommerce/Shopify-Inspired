import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { ArchivedReview, Category, Media, Product, Review, StockMovement, Store, assertCan, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { publishProblem } from '@/lib/product-lifecycle';
import { purgeExpiredProducts, retentionCutoff, toArchivedReview, trashDaysLeft, type PurgeableProduct } from '@/lib/trash';

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

interface UpdateStage {
  $set?: Doc;
  $inc?: Record<string, number>;
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
  findOneAndUpdate: (filter: Doc, update: UpdateStage[] | UpdateStage) => StubQuery;
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
let reviews: Doc[];
let archived: Doc[];
let publishPOST: ItemHandler;
let unpublishPOST: ItemHandler;
let restorePOST: ItemHandler;
let retentionPOST: CollectionHandler;
let adjustPOST: CollectionHandler;
let inventoryGET: CollectionHandler;
let historyGET: CollectionHandler;
let movements: Doc[];

const MovementStub = StockMovement as unknown as {
  create: (doc: Doc) => Promise<unknown>;
  find: (filter: Doc) => unknown;
  countDocuments: (filter: Doc) => Promise<number>;
};
const ReviewStub = Review as unknown as { find: (filter: Doc) => unknown; deleteMany: (filter: Doc) => Promise<unknown> };
const ArchiveStub = ArchivedReview as unknown as {
  bulkWrite: (ops: Array<{ updateOne: { filter: { _id: unknown }; update: { $setOnInsert: Doc } } }>) => Promise<unknown>;
};

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
  publishPOST = (await import('../src/app/api/products/[id]/publish/route')).POST;
  unpublishPOST = (await import('../src/app/api/products/[id]/unpublish/route')).POST;
  restorePOST = (await import('../src/app/api/products/[id]/restore/route')).POST;
  retentionPOST = (await import('../src/app/api/internal/retention/route')).POST;
  adjustPOST = (await import('../src/app/api/inventory/adjust/route')).POST;
  inventoryGET = (await import('../src/app/api/inventory/route')).GET;
  historyGET = (await import('../src/app/api/inventory/history/route')).GET;
});

function variantMatches(candidate: Doc, clause: Doc): boolean {
  return Object.entries(clause).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some((inner) => variantMatches(candidate, inner));
    if (typeof value === 'object' && value !== null) {
      const bound = value as { $gt?: number; $gte?: number; $lte?: number };
      const number = Number(candidate[key]);
      if (bound.$gt !== undefined) return number > bound.$gt;
      if (bound.$gte !== undefined) return number >= bound.$gte;
      if (bound.$lte !== undefined) return number <= bound.$lte;
    }
    return String(candidate[key]) === String(value);
  });
}

function matches(row: ProductRow, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some((clause) => matches(row, clause));
    if (key === 'variants') return row.variants.some((candidate) => variantMatches(candidate, (value as { $elemMatch: Doc }).$elemMatch));
    if (value === null) return (row[key] ?? null) === null;
    if (key === 'deletedBy.role') return (row.deletedBy as { role?: string } | null)?.role !== (value as { $ne: string }).$ne;
    if (typeof value === 'object' && value !== null && '$type' in value) return !!row[key];
    if (typeof value === 'object' && value !== null && '$regex' in value) {
      const { $regex, $options } = value as { $regex: string; $options?: string };
      return new RegExp($regex, $options).test(String(row[key]));
    }
    if (typeof value === 'object' && value !== null && '$lt' in value) {
      return !!row[key] && new Date(row[key] as string) < (value as { $lt: Date }).$lt;
    }
    if (key !== '_id' && typeof value === 'object' && value !== null && '$ne' in value) {
      return (row[key] ?? null) !== (value as { $ne: unknown }).$ne;
    }
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
  if (typeof expression !== 'object' || expression === null || expression instanceof Date) return expression;

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
  hideWhenOutOfStock: false,
  deletedAt: null,
  deletedBy: null,
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
  reviews = [];
  archived = [];

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
    reviewFind: ReviewStub.find,
    reviewDelete: ReviewStub.deleteMany,
    archive: ArchiveStub.bulkWrite,
    movement: MovementStub.create,
    movementFind: MovementStub.find,
    movementCount: MovementStub.countDocuments,
  };

  movements = [];
  const movementsOf = (filter: Doc): Doc[] =>
    movements.filter((movement) => Object.entries(filter).every(([key, value]) => String(movement[key]) === String(value)));
  MovementStub.create = async (doc) => doc;
  MovementStub.find = (filter) => {
    const q = { sort: () => q, skip: () => q, limit: () => q, lean: async () => movementsOf(filter) };
    return q;
  };
  MovementStub.countDocuments = async (filter) => movementsOf(filter).length;
  ReviewStub.find = (filter) => {
    const q = {
      select: () => q,
      lean: async () => reviews.filter((review) => String(review.product) === String(filter.product) && String(review.store) === String(filter.store)),
    };
    return q;
  };
  ReviewStub.deleteMany = async (filter) => {
    reviews = reviews.filter((review) => String(review.product) !== String(filter.product));
    return {};
  };
  ArchiveStub.bulkWrite = async (ops) => {
    for (const op of ops) {
      if (!archived.some((row) => row._id === op.updateOne.filter._id)) {
        archived.push({ _id: op.updateOne.filter._id, ...op.updateOne.update.$setOnInsert });
      }
    }
    return {};
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
      for (const stage of Array.isArray(update) ? update : [update]) {
        for (const [field, value] of Object.entries(stage.$set ?? {})) (row as Doc)[field] = evaluate(value, stored);
        const delta = stage.$inc?.['variants.$.stockQuantity'];
        if (delta !== undefined) {
          const wanted = String((filter.variants as { $elemMatch: { _id: unknown } }).$elemMatch._id);
          const target = row.variants.find((candidate) => String(candidate._id) === wanted);
          if (target) target.stockQuantity += delta;
        }
      }
    }
    return query(row ? [row] : [], true);
  };
  ProductStub.deleteOne = async (filter) => {
    const before = products.length;
    products = products.filter((row) => !matches(row, filter));
    return { deletedCount: before - products.length };
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
    ReviewStub.find = saved.reviewFind;
    ReviewStub.deleteMany = saved.reviewDelete;
    ArchiveStub.bulkWrite = saved.archive;
    MovementStub.create = saved.movement;
    MovementStub.find = saved.movementFind;
    MovementStub.countDocuments = saved.movementCount;
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
  assert.equal((await listGET(request('GET', '/api/products', { query: '?status=archived' }))).status, 422);
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

test('delete: a demo product skips trash and goes for good', async () => {
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

/* ------------------------------------------------ images ------------------------------------------------ */

const MEDIA_IDS = Array.from({ length: 11 }, (_, index) => '65a0000000000000000001' + index.toString(16).padStart(2, '0'));

function ownAllMedia(): void {
  MediaStub.countDocuments = async (filter) => filter._id.$in.filter((id) => id !== MEDIA_B).length;
}

test('images: an image of another store is refused on the gallery and on a variant', async () => {
  const gallery = await patch(PRODUCT_A, { media: [MEDIA_A, MEDIA_B] });
  assert.equal(gallery.status, 422);
  assert.equal(await errorCode(gallery), 'PRODUCT_MEDIA_INVALID');

  const linked = await patch(PRODUCT_A, { variants: [{ id: VARIANT_A, imageId: MEDIA_B }] });
  assert.equal(linked.status, 422);
  assert.equal(await errorCode(linked), 'PRODUCT_MEDIA_INVALID');
  assert.equal(row(PRODUCT_A).variants[0].imageId, null);
});

test('images: ten fit and an eleventh is refused', async () => {
  ownAllMedia();
  assert.equal((await patch(PRODUCT_A, { media: MEDIA_IDS.slice(0, 10) })).status, 200);
  assert.equal(row(PRODUCT_A).media.length, 10);
  assert.equal((await patch(PRODUCT_A, { media: MEDIA_IDS })).status, 422);
  assert.equal(row(PRODUCT_A).media.length, 10);
});

test('images: a new order persists, the first is the primary, and a removed image is gone', async () => {
  ownAllMedia();
  await patch(PRODUCT_A, { media: MEDIA_IDS.slice(0, 3) });
  const res = await patch(PRODUCT_A, { media: [MEDIA_IDS[2], MEDIA_IDS[0]] });
  assert.equal(res.status, 200);
  assert.deepEqual(row(PRODUCT_A).media.map(String), [MEDIA_IDS[2], MEDIA_IDS[0]]);
  const body = (await res.json()) as { imageUrl: string; media: Array<{ id: string }> };
  assert.match(body.imageUrl, new RegExp(MEDIA_IDS[2]));
  assert.deepEqual(body.media.map((image) => image.id), [MEDIA_IDS[2], MEDIA_IDS[0]]);
});

test('images: a variant links to an image of this store', async () => {
  const res = await patch(SIZED_A, { media: [MEDIA_A], variants: [{ id: VARIANT_S, imageId: MEDIA_A }, { id: VARIANT_M }] });
  assert.equal(res.status, 200);
  assert.equal(String(row(SIZED_A).variants[0].imageId), MEDIA_A);
  assert.equal(row(SIZED_A).variants[1].imageId, null);
});

test('images: a variant link can be cleared', async () => {
  row(SIZED_A).variants[0].imageId = MEDIA_A;
  assert.equal((await patch(SIZED_A, { variants: [{ id: VARIANT_S, imageId: null }, { id: VARIANT_M }] })).status, 200);
  assert.equal(row(SIZED_A).variants[0].imageId, null);
});

/* ---------------------------------------------- publishing ---------------------------------------------- */

test('variant builder: a first option keeps the Default variant, its id, SKU and stock, on the first combination', async () => {
  row(PRODUCT_A).variants[0].sku = 'KEEP-ME';
  row(PRODUCT_A).variants[0].stockQuantity = 7;
  const res = await patch(PRODUCT_A, {
    options: [{ name: 'Size', values: ['S', 'M'] }],
    variants: [
      { id: VARIANT_A, optionValues: ['S'] },
      { optionValues: ['M'], price: 1200, stockQuantity: 4 },
    ],
  });
  assert.equal(res.status, 200);
  const [first, second] = row(PRODUCT_A).variants;
  assert.equal(String(first._id), VARIANT_A);
  assert.equal(first.stockQuantity, 7);
  assert.equal(first.sku, 'KEEP-ME');
  assert.equal(first.title, 'S');
  assert.deepEqual(first.optionValues, ['S']);
  assert.equal(second.stockQuantity, 4);
  assert.equal(second.title, 'M');
  assert.deepEqual(row(PRODUCT_A).options, [{ name: 'Size', values: ['S', 'M'] }]);
});

test('variant builder: re-sending the whole list keeps every stock, and a variant left out is removed', async () => {
  const res = await patch(SIZED_A, {
    options: [{ name: 'Size', values: ['S', 'L'] }],
    variants: [
      { id: VARIANT_S, optionValues: ['S'], price: 950 },
      { optionValues: ['L'], price: 1000, stockQuantity: 2 },
    ],
  });
  assert.equal(res.status, 200);
  const variants = row(SIZED_A).variants;
  assert.equal(variants.length, 2);
  assert.equal(String(variants[0]._id), VARIANT_S);
  assert.equal(variants[0].stockQuantity, 3);
  assert.equal(variants[0].price, 950);
  assert.ok(!variants.some((candidate) => String(candidate._id) === VARIANT_M));
});

test('variant builder: a repeated combination is refused and nothing is written', async () => {
  const before = writes;
  const res = await patch(SIZED_A, {
    variants: [
      { id: VARIANT_S, optionValues: ['S'] },
      { id: VARIANT_M, optionValues: ['S'] },
    ],
  });
  assert.equal(res.status, 422);
  assert.equal(await errorCode(res), 'INVALID_VARIANTS');
  assert.equal(writes, before);
});

test("variant image: it must be one of this product's images, on create, on patch, and when the gallery changes", async () => {
  ownAllMedia();
  const outside = await patch(PRODUCT_A, { variants: [{ id: VARIANT_A, imageId: MEDIA_A }] });
  assert.equal(outside.status, 422);
  assert.equal(await errorCode(outside), 'PRODUCT_MEDIA_INVALID');

  const together = await patch(PRODUCT_A, { media: [MEDIA_A], variants: [{ id: VARIANT_A, imageId: MEDIA_A }] });
  assert.equal(together.status, 200);

  const dropped = await patch(PRODUCT_A, { media: [] });
  assert.equal(dropped.status, 422);
  assert.equal(await errorCode(dropped), 'PRODUCT_MEDIA_INVALID');
  assert.equal(row(PRODUCT_A).media.length, 1);

  const created = await create({ title: validCreate.title, categories: validCreate.categories, variants: [{ price: 1000, imageId: MEDIA_A }] });
  assert.equal(created.status, 422);
  assert.equal(await errorCode(created), 'PRODUCT_MEDIA_INVALID');
});

const publish = (id: string, call: Call = {}): Promise<Response> => publishPOST(request('POST', '/api/products/' + id + '/publish', call), ctx(id));
const unpublish = (id: string, call: Call = {}): Promise<Response> => unpublishPOST(request('POST', '/api/products/' + id + '/unpublish', call), ctx(id));
const liveIds = async (): Promise<string[]> => {
  const res = await liveListGET(new NextRequest('http://seller.test/api/storefront/v1/stores/' + STORE_A + '/products'), ctx(STORE_A));
  return ((await res.json()) as { data: Array<{ id: string }> }).data.map((item) => item.id);
};

test('publish makes a draft Live, and unpublish takes it back', async () => {
  assert.deepEqual(await liveIds(), []);
  const res = await publish(PRODUCT_A);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { status: string }).status, 'published');
  assert.deepEqual(await liveIds(), [PRODUCT_A]);

  assert.equal((await unpublish(PRODUCT_A)).status, 200);
  assert.equal(row(PRODUCT_A).isPublished, false);
  assert.deepEqual(await liveIds(), []);
});

test('an unedited demo product cannot be published; after an edit it can (D-022, D-037)', async () => {
  const refused = await publish(DEMO_A);
  assert.equal(refused.status, 422);
  assert.equal(await errorCode(refused), 'PRODUCT_DEMO_NOT_EDITED');
  assert.equal(row(DEMO_A).isPublished, false);

  await patch(DEMO_A, { title: 'My first kurta' });
  assert.equal((await publish(DEMO_A)).status, 200);
});

test('the publish rules, each with its own code', () => {
  const complete = { title: 'Kurta', isDemo: false, categories: [CAT_A], variants: [{ price: 100 }] };
  assert.equal(publishProblem(complete), null);
  assert.equal(publishProblem({ ...complete, title: ' ' })?.code, 'PRODUCT_TITLE_REQUIRED');
  assert.equal(publishProblem({ ...complete, categories: [] })?.code, 'PRODUCT_CATEGORY_REQUIRED');
  assert.equal(publishProblem({ ...complete, variants: [] })?.code, 'PRODUCT_PRICE_REQUIRED');
  assert.equal(publishProblem({ ...complete, variants: [{ price: 0 }] })?.code, 'PRODUCT_PRICE_REQUIRED');
  assert.equal(publishProblem({ ...complete, variants: [{ price: 0 }, { price: 5 }] }), null);
});

test('a PATCH still cannot publish, and an admin or another store cannot either', async () => {
  assert.equal((await patch(PRODUCT_A, { isPublished: true })).status, 422);
  assert.equal((await publish(PRODUCT_A, { token: adminToken })).status, 403);
  assert.equal((await publish(PRODUCT_B)).status, 404);
  assert.equal((await unpublish(PRODUCT_B)).status, 404);
  assert.equal(row(PRODUCT_B).isPublished, false);
});

test('hideWhenOutOfStock leaves Live lists only while nothing can be bought', async () => {
  row(PRODUCT_A).isPublished = true;
  assert.equal((await patch(PRODUCT_A, { hideWhenOutOfStock: true })).status, 200);
  assert.deepEqual(await liveIds(), [PRODUCT_A]);

  row(PRODUCT_A).variants[0].stockQuantity = 0;
  assert.deepEqual(await liveIds(), []);

  row(PRODUCT_A).variants[0].trackQuantity = false;
  assert.deepEqual(await liveIds(), [PRODUCT_A]);

  row(PRODUCT_A).variants[0].trackQuantity = true;
  row(PRODUCT_A).hideWhenOutOfStock = false;
  assert.deepEqual(await liveIds(), [PRODUCT_A], 'without the option an out-of-stock product stays listed');
});

/* ------------------------------------------------- trash ------------------------------------------------- */

const trash = (id: string, call: Call = {}): Promise<Response> => itemDELETE(request('DELETE', '/api/products/' + id, call), ctx(id));
const purge = (id: string, call: Call = {}): Promise<Response> =>
  itemDELETE(request('DELETE', '/api/products/' + id, { ...call, query: '?permanent=true' }), ctx(id));
const restoreItem = (id: string, call: Call = {}): Promise<Response> => restorePOST(request('POST', '/api/products/' + id + '/restore', call), ctx(id));
const listed = async (query: string): Promise<string[]> => {
  const res = await listGET(request('GET', '/api/products', { query }));
  return ((await res.json()) as { docs: Array<{ id: string }> }).docs.map((doc) => doc.id);
};

test('delete moves a product to trash: unpublished, stamped, and hidden everywhere but the trash view', async () => {
  row(PRODUCT_A).isPublished = true;
  const res = await trash(PRODUCT_A);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { trashed: true, id: PRODUCT_A });

  assert.equal(row(PRODUCT_A).isPublished, false);
  assert.ok(row(PRODUCT_A).deletedAt instanceof Date);
  assert.equal((row(PRODUCT_A).deletedBy as { role: string }).role, 'seller');

  for (const query of ['', '?status=all', '?status=draft', '?status=published']) assert.ok(!(await listed(query)).includes(PRODUCT_A), query);
  assert.deepEqual(await listed('?status=trash'), [PRODUCT_A]);
  assert.equal((await itemGET(request('GET', '/api/products/' + PRODUCT_A), ctx(PRODUCT_A))).status, 404);
  assert.deepEqual(await liveIds(), []);
});

test('a trashed product cannot be edited, published, unpublished, or trashed again', async () => {
  await trash(PRODUCT_A);
  assert.equal((await patch(PRODUCT_A, { title: 'Back from the dead' })).status, 404);
  assert.notEqual(row(PRODUCT_A).title, 'Back from the dead');
  assert.equal((await publish(PRODUCT_A)).status, 404);
  assert.equal((await unpublish(PRODUCT_A)).status, 404);
  assert.equal((await trash(PRODUCT_A)).status, 404);
  assert.equal(row(PRODUCT_A).isPublished, false);
});

test('a product trashed between the read and the write of a PATCH is left alone', async () => {
  betweenReadAndWrite = () => {
    row(PRODUCT_A).deletedAt = new Date();
  };
  const res = await patch(PRODUCT_A, { title: 'Too late' });
  assert.equal(res.status, 409);
  assert.notEqual(row(PRODUCT_A).title, 'Too late');
});

test('the trash view says how long is left, and a restored product comes back as a draft', async () => {
  row(PRODUCT_A).isPublished = true;
  await trash(PRODUCT_A);
  const list = (await (await listGET(request('GET', '/api/products', { query: '?status=trash' }))).json()) as {
    docs: Array<{ status: string; trash: { daysLeft: number; restorable: boolean } }>;
  };
  assert.equal(list.docs[0].status, 'trash');
  assert.equal(list.docs[0].trash.daysLeft, 365);
  assert.equal(list.docs[0].trash.restorable, true);

  const res = await restoreItem(PRODUCT_A);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; trash: unknown };
  assert.equal(body.status, 'draft');
  assert.equal(body.trash, null);
  assert.equal(row(PRODUCT_A).deletedAt, null);
  assert.equal(row(PRODUCT_A).isPublished, false);
});

test('restore: only from trash, only this store, and never what an admin deleted', async () => {
  const notTrashed = await restoreItem(PRODUCT_A);
  assert.equal(notTrashed.status, 409);
  assert.equal(await errorCode(notTrashed), 'PRODUCT_NOT_IN_TRASH');
  assert.equal((await restoreItem(PRODUCT_B)).status, 404);

  Object.assign(row(PRODUCT_A), { deletedAt: new Date(), deletedBy: { user: ADMIN, role: 'admin' } });
  const refused = await restoreItem(PRODUCT_A);
  assert.equal(refused.status, 403);
  assert.equal(await errorCode(refused), 'PRODUCT_ADMIN_DELETED');
  assert.ok(row(PRODUCT_A).deletedAt);

  const list = (await (await listGET(request('GET', '/api/products', { query: '?status=trash' }))).json()) as { docs: Array<{ trash: { restorable: boolean } }> };
  assert.equal(list.docs[0].trash.restorable, false);
  assert.equal((await purge(PRODUCT_A)).status, 403, 'nor may the seller destroy it');
});

test('permanent delete works only from trash, and archives reviews without the customer', async () => {
  const notTrashed = await purge(PRODUCT_A);
  assert.equal(notTrashed.status, 409);
  assert.equal(await errorCode(notTrashed), 'PRODUCT_NOT_IN_TRASH');
  assert.ok(row(PRODUCT_A));

  reviews = [
    {
      _id: 'r1',
      product: PRODUCT_A,
      store: STORE_A,
      customer: SELLER_B,
      order: 'o1',
      images: [MEDIA_A],
      rating: 4,
      title: 'Nice',
      body: 'Soft fabric',
      status: 'approved',
      createdAt: new Date(NOW),
    },
    { _id: 'r2', product: PRODUCT_B, store: STORE_B, rating: 1, body: 'Other product', createdAt: new Date(NOW) },
  ];
  await trash(PRODUCT_A);
  assert.equal((await purge(PRODUCT_A)).status, 200);

  assert.ok(!products.some((candidate) => candidate._id === PRODUCT_A));
  assert.deepEqual(reviews.map((review) => review._id), ['r2']);
  assert.equal(archived.length, 1);
  const { archivedAt, reviewedAt, ...kept } = archived[0];
  assert.ok(archivedAt instanceof Date);
  assert.equal((reviewedAt as Date).toISOString(), NOW);
  assert.deepEqual(kept, {
    _id: 'r1',
    rating: 4,
    title: 'Nice',
    body: 'Soft fabric',
    product: { title: 'Kurta b1', slug: 'kurta-b1', store: STORE_A },
  });
});

test('the archived shape is built field by field: an identifier added to a review stays out', () => {
  const review = { _id: 'r1', rating: 5, body: 'Good', createdAt: new Date(NOW), phone: '0300', address: 'Home', customerName: 'Sara' };
  const shaped = toArchivedReview(review as never, { _id: 'p', store: 's', title: 'T', slug: 't' } as unknown as PurgeableProduct, new Date(NOW));
  assert.deepEqual(Object.keys(shaped).sort(), ['archivedAt', 'body', 'product', 'rating', 'reviewedAt', 'title']);
  assert.equal(JSON.stringify(shaped).includes('0300'), false);
});

test('a product restored while it was being purged survives with its reviews', async () => {
  await trash(PRODUCT_A);
  reviews = [{ _id: 'r1', product: PRODUCT_A, store: STORE_A, rating: 4, body: 'Soft', createdAt: new Date(NOW) }];
  const saved = ArchiveStub.bulkWrite;
  ArchiveStub.bulkWrite = async (ops) => {
    row(PRODUCT_A).deletedAt = null;
    return saved(ops);
  };
  assert.equal((await purge(PRODUCT_A)).status, 404);
  assert.ok(row(PRODUCT_A));
  assert.equal(reviews.length, 1);
});

test('an admin session cannot trash or purge through the seller route', async () => {
  assert.equal((await trash(PRODUCT_A, { token: adminToken })).status, 403);
  assert.equal((await purge(PRODUCT_A, { token: adminToken })).status, 403);
});

/* ----------------------------------------------- retention ----------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;
const RETENTION_NOW = new Date('2027-06-01T00:00:00.000Z');
const daysAgo = (days: number): Date => new Date(RETENTION_NOW.getTime() - days * DAY);

test('retention purges only what has been in trash for more than 365 days', async () => {
  row(PRODUCT_A).deletedAt = daysAgo(366);
  row(PRODUCT_B).deletedAt = daysAgo(365);
  row(SIZED_A).deletedAt = daysAgo(10);
  reviews = [{ _id: 'r1', product: PRODUCT_A, store: STORE_A, rating: 4, body: 'Soft', createdAt: new Date(NOW) }];

  const seen: unknown[] = [];
  const result = await purgeExpiredProducts(RETENTION_NOW, { beforePurge: async (item) => void seen.push(item._id) });

  assert.deepEqual(result, { purged: 1, failed: 0, more: false });
  assert.deepEqual(seen, [PRODUCT_A], 'the email hook is told first');
  assert.deepEqual(products.map((candidate) => candidate._id).sort(), [DEMO_A, PRODUCT_B, SIZED_A].sort());
  assert.equal(archived.length, 1);
  assert.equal(reviews.length, 0);
});

test('retention arithmetic: the cutoff, and the days a seller is told', () => {
  assert.equal(retentionCutoff(RETENTION_NOW).getTime(), daysAgo(365).getTime());
  assert.equal(trashDaysLeft(daysAgo(0), RETENTION_NOW), 365);
  assert.equal(trashDaysLeft(daysAgo(364.5), RETENTION_NOW), 1);
  assert.equal(trashDaysLeft(daysAgo(400), RETENTION_NOW), 0);
});

test('one product that fails to purge does not stop the others', async () => {
  row(PRODUCT_A).deletedAt = daysAgo(400);
  row(SIZED_A).deletedAt = daysAgo(400);
  const logged = console.error;
  console.error = () => {};
  try {
    const result = await purgeExpiredProducts(RETENTION_NOW, {
      beforePurge: async (item) => {
        if (item._id as unknown as string === PRODUCT_A) throw new Error('mail is down');
      },
    });
    assert.deepEqual(result, { purged: 1, failed: 1, more: false });
    assert.ok(row(PRODUCT_A));
  } finally {
    console.error = logged;
  }
});

test('the retention route is closed without its secret, and system is the only actor it runs as', async () => {
  const call = (secret?: string): Promise<Response> =>
    retentionPOST(new NextRequest('http://seller.test/api/internal/retention', { method: 'POST', headers: secret ? { 'x-retention-secret': secret } : {} }));

  delete process.env.RETENTION_CRON_SECRET;
  assert.equal((await call('anything')).status, 503);

  process.env.RETENTION_CRON_SECRET = 'a-long-shared-secret';
  assert.equal((await call()).status, 401);
  assert.equal((await call('wrong')).status, 401);

  row(PRODUCT_A).deletedAt = new Date(Date.now() - 400 * DAY);
  const res = await call('a-long-shared-secret');
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { purged: number }).purged, 1);
  delete process.env.RETENTION_CRON_SECRET;

  assert.doesNotThrow(() => assertCan('system', 'delete', 'productLifecycle'));
});

/* --------------------------------------------- inventory routes --------------------------------------------- */

const adjust = (lines: unknown, call: Call = {}): Promise<Response> =>
  adjustPOST(request('POST', '/api/inventory/adjust', { ...call, body: { lines } }));

test('adjust: this store only, a body naming a store is refused, and an admin may not adjust', async () => {
  const foreign = await adjust([{ productId: PRODUCT_B, variantId: VARIANT_B, delta: 1, reason: 'x' }]);
  assert.equal(foreign.status, 422);
  assert.equal(await errorCode(foreign), 'PRODUCT_NOT_FOUND');
  assert.equal(row(PRODUCT_B).variants[0].stockQuantity, 7);

  const stray = await adjustPOST(request('POST', '/api/inventory/adjust', { body: { store: STORE_B, lines: [] } }));
  assert.equal(stray.status, 422);
  assert.equal((await adjust([{ productId: PRODUCT_A, variantId: VARIANT_A, delta: 1, reason: 'x' }], { token: adminToken })).status, 403);
});

test('adjust: a line needs exactly one of delta and setTo, and a reason', async () => {
  const base = { productId: PRODUCT_A, variantId: VARIANT_A };
  for (const line of [{ ...base, reason: 'x' }, { ...base, delta: 1, setTo: 1, reason: 'x' }, { ...base, delta: 1 }, { ...base, delta: 0, reason: 'x' }, { ...base, setTo: -1, reason: 'x' }]) {
    assert.equal((await adjust([line])).status, 422, JSON.stringify(line));
  }
  assert.equal(row(PRODUCT_A).variants[0].stockQuantity, 7);
});

test('adjust answers 200 with per-line results when any line worked', async () => {
  const res = await adjust([
    { productId: PRODUCT_A, variantId: VARIANT_A, delta: 2, reason: 'Delivery' },
    { productId: PRODUCT_B, variantId: VARIANT_B, delta: 2, reason: 'Delivery' },
  ]);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { succeeded: number; failed: number };
  assert.deepEqual([body.succeeded, body.failed], [1, 1]);
  assert.equal(row(PRODUCT_A).variants[0].stockQuantity, 9);
});

test('the inventory list leaves out trash and carries the status the backend derived', async () => {
  await trash(PRODUCT_A);
  const res = await inventoryGET(request('GET', '/api/inventory'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { docs: Array<{ id: string; variants: Array<{ id: string; availability: string }> }> };
  assert.ok(!body.docs.some((doc) => doc.id === PRODUCT_A || doc.id === PRODUCT_B));
  const sized = body.docs.find((doc) => doc.id === SIZED_A);
  assert.deepEqual(sized?.variants.map((v) => [v.id, v.availability]), [[VARIANT_S, 'in_stock'], [VARIANT_M, 'out_of_stock']]);
});

test('the inventory list searches by title and says how many pages there are, so every product can be reached', async () => {
  const found = (await (await inventoryGET(request('GET', '/api/inventory', { query: '?q=KURTA%20B4' }))).json()) as { docs: Array<{ id: string }> };
  assert.deepEqual(found.docs.map((doc) => doc.id), [SIZED_A]);

  const paged = (await (await inventoryGET(request('GET', '/api/inventory', { query: '?page=2&limit=1' }))).json()) as { page: number; totalDocs: number; totalPages: number };
  assert.deepEqual([paged.page, paged.totalDocs, paged.totalPages], [2, 3, 3]);
});

const movement = (id: string, store: string, product: string, variantId: string, overrides: Doc = {}): Doc => ({
  _id: id,
  store,
  product,
  variantId,
  previousQuantity: 7,
  delta: -1,
  quantity: 6,
  reason: 'Order ORD-1',
  actor: null,
  changedAt: new Date(NOW),
  ...overrides,
});

test('stock history reads this store only, can narrow to a variant, and says who made a change', async () => {
  movements = [
    movement('65a0000000000000000000f1', STORE_A, SIZED_A, VARIANT_S, { actor: SELLER_A, reason: 'Stock count', delta: 2, quantity: 9 }),
    movement('65a0000000000000000000f2', STORE_A, SIZED_A, VARIANT_M),
    movement('65a0000000000000000000f3', STORE_B, SIZED_A, VARIANT_S),
  ];
  const read = async (query: string): Promise<Array<{ id: string; actor: string | null; reason: string }>> => {
    const res = await historyGET(request('GET', '/api/inventory/history', { query }));
    assert.equal(res.status, 200);
    return ((await res.json()) as { docs: Array<{ id: string; actor: string | null; reason: string }> }).docs;
  };

  const all = await read('?productId=' + SIZED_A);
  assert.deepEqual(all.map((entry) => entry.id), ['65a0000000000000000000f1', '65a0000000000000000000f2']);

  const one = await read('?productId=' + SIZED_A + '&variantId=' + VARIANT_S);
  assert.deepEqual(one.map((entry) => [entry.reason, entry.actor]), [['Stock count', SELLER_A]]);
  assert.deepEqual((await read('?productId=' + SIZED_A + '&variantId=' + VARIANT_M)).map((entry) => entry.actor), [null]);
});

test('stock history needs a product, refuses a malformed id, and is not open to an admin or another store', async () => {
  const history = (query: string, call: Call = {}): Promise<Response> => historyGET(request('GET', '/api/inventory/history', { ...call, query }));
  assert.equal((await history('')).status, 422);
  assert.equal((await history('?productId=nope')).status, 422);
  assert.equal((await history('?productId=' + SIZED_A + '&variantId=nope')).status, 422);
  assert.equal((await history('?productId=' + SIZED_A, { token: adminToken })).status, 403);
  assert.equal((await history('?productId=' + SIZED_A, { storeHeader: STORE_B })).status, 403);
});

test('a trashed product keeps its slug and SKU, so restoring it can never clash, and the refusal says why', async () => {
  row(PRODUCT_A).slug = 'blue-lawn-suit';
  row(PRODUCT_A).variants[0].sku = 'BLS-1';
  await trash(PRODUCT_A);

  const slug = await create(validCreate);
  assert.equal(slug.status, 409);
  const slugError = ((await slug.json()) as { errors: Array<{ code: string; message: string }> }).errors[0];
  assert.equal(slugError.code, 'PRODUCT_SLUG_TAKEN');
  assert.match(slugError.message, /trash/);

  const sku = await create({ ...validCreate, slug: 'another-suit', sku: 'BLS-1' });
  assert.equal(sku.status, 409);
  const skuError = ((await sku.json()) as { errors: Array<{ code: string; message: string }> }).errors[0];
  assert.equal(skuError.code, 'SKU_TAKEN');
  assert.match(skuError.message, /trash/);
});
