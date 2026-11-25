import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { ApiKey, Category, Media, Order, Product, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { useMemoryAuthLimits } from '../src/lib/account-support';
import { generateApiKey } from '../src/lib/api-keys';
import { limitApiKey } from '../src/lib/api-rate-limit';
import { setPlanLoader } from '../src/lib/plan';

// Sprint 8 (S8-B5, D-118): the read-only public API v1. Models are in memory; no database. The stubs answer WHOLE rows, so a field that must not be answered
// has to be dropped by the code under test.

const OWNER_A = '65a000000000000000000001';
const OWNER_B = '65a000000000000000000002';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const KEY_A = '65a0000000000000000000e1';
const KEY_B = '65a0000000000000000000e2';
const CAT_A = '65a0000000000000000000c1';
const IMG_1 = '65a0000000000000000000d1';
const IMG_2 = '65a0000000000000000000d2';
const VIDEO = '65a0000000000000000000d3';
const id = (kind: 'a' | 'b', n: number) => '65a00000000000000000' + (kind === 'a' ? 'a' : 'b') + String(n).padStart(3, '0');

const { apiV1ErrorSchema, apiV1OrderDetailSchema, apiV1OrderListSchema, apiV1OrderSchema, apiV1ProductDetailSchema, apiV1ProductListSchema, apiV1ProductSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

type Row = Record<string, any>;
type Handler = (request: Request, context: any) => Promise<Response>;

let productsList: Handler;
let productsDetail: Handler;
let ordersList: Handler;
let ordersDetail: Handler;

let keys: Row[];
let stores: Row[];
let users: Row[];
let products: Row[];
let orders: Row[];
let selects: Record<string, string[]>;
let touches: Row[];
let keyLimit: number | null;
let failing: Set<string>;
let tokenA: ReturnType<typeof generateApiKey>;
let tokenB: ReturnType<typeof generateApiKey>;
let restore: () => void = () => {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = 'x'.repeat(40);
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  productsList = (await import('../src/app/api/v1/products/route')).GET as Handler;
  productsDetail = (await import('../src/app/api/v1/products/[id]/route')).GET as Handler;
  ordersList = (await import('../src/app/api/v1/orders/route')).GET as Handler;
  ordersDetail = (await import('../src/app/api/v1/orders/[id]/route')).GET as Handler;
});

const comparable = (value: unknown): any => (value instanceof Date ? value.getTime() : value === undefined || value === null ? null : String(value));
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, wanted]) => {
    if (key === '$or') return (wanted as Row[]).some((branch) => matches(row, branch));
    const actual = row[key];
    if (wanted === null) return actual === null || actual === undefined;
    if (typeof wanted === 'object' && !(wanted instanceof Date)) {
      if (wanted.$in) return wanted.$in.map(String).includes(String(actual));
      if (wanted.$gte) return actual !== null && actual !== undefined && comparable(actual) >= comparable(wanted.$gte);
      if (wanted.$lte) return actual !== null && actual !== undefined && comparable(actual) <= comparable(wanted.$lte);
      if (wanted.$lt) return actual !== null && actual !== undefined && comparable(actual) < comparable(wanted.$lt);
    }
    return comparable(actual) === comparable(wanted);
  });
}

function query(name: string, value: () => Row[] | Row | null) {
  let sort: Row = {};
  let limit = Infinity;
  const q: any = {
    select: (fields: string) => ((selects[name] ??= []).push(fields), q),
    sort: (by: Row) => ((sort = by), q),
    limit: (n: number) => ((limit = n), q),
    lean: async () => {
      if (failing.has(name)) throw new Error('database down');
      const out = value();
      if (!Array.isArray(out)) return out;
      const sorted = [...out].sort((a, b) => {
        for (const [key, direction] of Object.entries(sort)) {
          const x = comparable(a[key]);
          const y = comparable(b[key]);
          if (x !== y) return (x < y ? -1 : 1) * (direction as number);
        }
        return 0;
      });
      return sorted.slice(0, limit);
    },
  };
  return q;
}

const at = (day: number) => new Date(Date.UTC(2026, 10, day, 10, 0, 0));

function product(kind: 'a' | 'b', n: number, extra: Row = {}): Row {
  return {
    _id: id(kind, n),
    store: kind === 'a' ? STORE_A : STORE_B,
    title: 'Product ' + kind + n,
    slug: 'product-' + kind + n,
    description: 'Cotton',
    minPrice: 500,
    variants: [{ price: 700, compareAtPrice: null, trackQuantity: true, stockQuantity: 3 }, { price: 500, compareAtPrice: 650, trackQuantity: true, stockQuantity: 4 }],
    isPublished: true,
    moderation: null,
    deletedAt: null,
    categories: [CAT_A],
    media: [IMG_2, VIDEO, IMG_1],
    createdAt: at(n),
    updatedAt: at(n),
    // Internal fields that must never be answered.
    deliveryCharge: 99,
    viewCount: 12,
    tags: ['internal-tag'],
    ...extra,
  };
}

const PII = ['Ayesha Khan', '+923001234567', 'ayesha@example.com', 'House 7, Street 9', '+923331112222', 'leave at the gate', 'seller private note'];

function order(kind: 'a' | 'b', n: number, extra: Row = {}): Row {
  return {
    _id: id(kind, 100 + n),
    store: kind === 'a' ? STORE_A : STORE_B,
    orderId: 'MKZ-' + kind.toUpperCase() + n,
    status: 'confirmed',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    items: [{ productId: id(kind, 1), variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Large', sku: 'SH-L', unitPrice: 500, quantity: 2, stockDeducted: true }],
    subtotal: 1000,
    deliveryCharges: 200,
    discountAmount: 100,
    taxAmount: 0,
    total: 1100,
    city: 'Lahore',
    customerName: PII[0],
    phone: PII[1],
    phoneKey: PII[1],
    customerEmail: PII[2],
    address: PII[3],
    customerWhatsapp: PII[4],
    customerNote: PII[5],
    notes: [{ text: PII[6] }],
    createdAt: at(n),
    updatedAt: at(n),
    ...extra,
  };
}

beforeEach(() => {
  useMemoryAuthLimits();
  tokenA = generateApiKey();
  tokenB = generateApiKey();
  keys = [
    { _id: KEY_A, store: STORE_A, prefix: tokenA.prefix, hash: tokenA.hash, scopes: ['products:read', 'orders:read'], revokedAt: null, lastUsedAt: null },
    { _id: KEY_B, store: STORE_B, prefix: tokenB.prefix, hash: tokenB.hash, scopes: ['products:read', 'orders:read'], revokedAt: null, lastUsedAt: null },
  ];
  stores = [
    { _id: STORE_A, owner: OWNER_A, status: 'active' },
    { _id: STORE_B, owner: OWNER_B, status: 'pending' },
  ];
  users = [{ _id: OWNER_A, accountStatus: 'active' }, { _id: OWNER_B }];
  products = [product('a', 1), product('a', 2), product('a', 3, { deletedAt: at(20) }), product('b', 4)];
  orders = [order('a', 1), order('a', 2), order('b', 3)];
  selects = {};
  touches = [];
  failing = new Set();
  keyLimit = 2;

  const models = [ApiKey, Store, User, Product, Order, Category, Media] as any[];
  const saved = models.map((model) => ({ model, find: model.find, findOne: model.findOne, findById: model.findById, updateOne: model.updateOne }));
  const connect = (mongoose as any).connect;
  (mongoose as any).connect = async () => mongoose;
  (ApiKey as any).findOne = (filter: Row) => query('apikey', () => keys.find((row) => matches(row, filter)) ?? null);
  (ApiKey as any).updateOne = async (filter: Row, update: Row) => {
    const row = keys.find((r) => matches(r, filter));
    if (row) {
      Object.assign(row, update.$set);
      touches.push({ id: row._id, at: update.$set.lastUsedAt });
    }
    return { matchedCount: row ? 1 : 0 };
  };
  (Store as any).findById = (storeId: string) => query('store', () => stores.find((row) => row._id === String(storeId)) ?? null);
  (User as any).findById = (userId: string) => query('user', () => users.find((row) => row._id === String(userId)) ?? null);
  (Product as any).find = (filter: Row) => query('product', () => products.filter((row) => matches(row, filter)));
  (Product as any).findOne = (filter: Row) => query('product', () => products.find((row) => matches(row, filter)) ?? null);
  (Order as any).find = (filter: Row) => query('order', () => orders.filter((row) => matches(row, filter)));
  (Order as any).findOne = (filter: Row) => query('order', () => orders.find((row) => matches(row, filter)) ?? null);
  const categories = [{ _id: CAT_A, store: STORE_A, name: 'Shirts', slug: 'shirts' }];
  const media = [
    { _id: IMG_1, store: STORE_A, url: 'https://cdn.test/1.jpg', alt: 'front', resourceType: 'image' },
    { _id: IMG_2, store: STORE_A, url: 'https://cdn.test/2.jpg', alt: 'back' },
    { _id: VIDEO, store: STORE_A, url: 'https://cdn.test/v.mp4', alt: 'clip', resourceType: 'video' },
  ];
  (Category as any).find = (filter: Row) => query('category', () => categories.filter((row) => matches(row, filter)));
  (Media as any).find = (filter: Row) => query('media', () => media.filter((row) => matches(row, filter)));
  setPlanLoader(async () => ({ key: 'growth', name: 'Growth', status: 'active', limits: { stores: 3, products: null, staffSeats: 3, apiKeys: keyLimit, customDomain: true, premiumThemes: true } }) as never);
  restore = () => {
    (mongoose as any).connect = connect;
    for (const { model, ...methods } of saved) Object.assign(model, methods);
    setPlanLoader(null);
  };
});

afterEach(() => restore());

interface CallOptions {
  /** The Authorization header; the default is key A. null sends none. */
  auth?: string | null;
  headers?: Record<string, string>;
  query?: string;
}

function call(handler: Handler, path: string, options: CallOptions = {}, recordId?: string): Promise<Response> {
  const auth = options.auth === undefined ? 'Bearer ' + tokenA.token : options.auth;
  const headers: Record<string, string> = { ...(options.headers ?? {}), ...(auth === null ? {} : { authorization: auth }) };
  return handler(new NextRequest('http://seller.test/api/v1/' + path + (options.query ?? ''), { headers }), { params: Promise.resolve({ id: recordId ?? '' }) });
}
const getProducts = (options: CallOptions = {}) => call(productsList, 'products', options);
const getProduct = (recordId: string, options: CallOptions = {}) => call(productsDetail, 'products/' + recordId, options, recordId);
const getOrders = (options: CallOptions = {}) => call(ordersList, 'orders', options);
const getOrder = (recordId: string, options: CallOptions = {}) => call(ordersDetail, 'orders/' + recordId, options, recordId);
const bearerB = () => 'Bearer ' + tokenB.token;
const json = async (res: Response) => (await res.json()) as any;
const errorCode = async (res: Response): Promise<string> => {
  const body = await json(res);
  assert.equal(apiV1ErrorSchema.safeParse(body).success, true, JSON.stringify(body));
  return body.error.code;
};

test('missing, malformed, unknown, wrong-secret and revoked keys are the same 401; a seller session is not a key', async () => {
  const session = await signSession({ sub: OWNER_A, role: 'seller' }, 'x'.repeat(40), SELLER_AUDIENCE);
  const wrongSecret = 'Bearer mkz_live_' + tokenA.prefix + '_' + generateApiKey().token.slice(-43);
  const cases: CallOptions[] = [
    { auth: null },
    { auth: 'Bearer nonsense' },
    { auth: 'Bearer ' + generateApiKey().token },
    { auth: wrongSecret },
    { auth: 'Bearer ' + session },
    { auth: null, headers: { cookie: 'markaz-session=' + session, 'x-store-id': STORE_A } },
  ];
  const bodies = new Set<string>();
  for (const options of cases) {
    const res = await getProducts(options);
    assert.equal(res.status, 401, JSON.stringify(options));
    bodies.add(await res.text());
  }
  keys[0]!.revokedAt = new Date();
  const revoked = await getProducts();
  assert.equal(revoked.status, 401);
  bodies.add(await revoked.text());
  assert.equal(bodies.size, 1);
  assert.equal(selects.product, undefined, 'nothing was read');
});

test('the scope of the route: a key without it is 403 FORBIDDEN_SCOPE and nothing is read', async () => {
  keys[0]!.scopes = ['products:read'];
  assert.equal((await getProducts()).status, 200);
  for (const res of [await getOrders(), await getOrder(id('a', 101))]) {
    assert.equal(res.status, 403);
    assert.equal(await errorCode(res), 'FORBIDDEN_SCOPE');
  }
  keys[0]!.scopes = ['orders:read'];
  assert.equal((await getProduct(id('a', 1))).status, 403);
  assert.equal(selects.order, undefined);
});

test('isolation by key: each key reads its own store; a record of the other store is 404; x-store-id, a cookie and ?store= change nothing', async () => {
  const spoof = { headers: { 'x-store-id': STORE_B, cookie: 'x-store-id=' + STORE_B }, query: '?store=' + STORE_B };
  const a = await json(await getProducts(spoof));
  assert.deepEqual(a.data.map((p: Row) => p.id).sort(), [id('a', 1), id('a', 2)]);
  const aOrders = await json(await getOrders(spoof));
  assert.deepEqual(aOrders.data.map((o: Row) => o.orderId).sort(), ['MKZ-A1', 'MKZ-A2']);
  const b = await json(await getProducts({ auth: bearerB() }));
  assert.deepEqual(b.data.map((p: Row) => p.id), [id('b', 4)]);
  assert.equal(b.data[0].category, null, 'a category of another store is never joined');
  assert.deepEqual(b.data[0].images, [], 'a picture of another store is never joined');
  assert.deepEqual((await json(await getOrders({ auth: bearerB() }))).data.map((o: Row) => o.orderId), ['MKZ-B3']);

  for (const res of [await getProduct(id('a', 1), { auth: bearerB() }), await getOrder(id('a', 101), { auth: bearerB() }), await getProduct(id('b', 4), spoof), await getOrder(id('b', 103), spoof)]) {
    assert.equal(res.status, 404);
    assert.equal(await errorCode(res), 'NOT_FOUND');
  }
  assert.equal((await getProduct(id('a', 3))).status, 404, 'a trashed product is not served');
  assert.equal((await getProduct('not-an-id')).status, 404);
  assert.equal((await getOrder('MKZ-A1')).status, 404);
});

test('a database failure in the key lookup, the store check or the query is 503, never 401', async () => {
  for (const name of ['apikey', 'store', 'user', 'product']) {
    failing = new Set([name]);
    const res = await getProducts();
    assert.equal(res.status, 503, name);
    assert.equal(await errorCode(res), 'SERVICE_UNAVAILABLE');
  }
  failing = new Set(['order']);
  assert.equal((await getOrders()).status, 503);
  failing = new Set();
  setPlanLoader(async () => {
    throw new Error('plans down');
  });
  assert.equal((await getProducts()).status, 503);
});

test('a suspended, archived or deleted store, or a suspended owner, is refused with 403 STORE_UNAVAILABLE', async () => {
  const cases: Array<() => void> = [
    () => (stores[0]!.status = 'suspended'),
    () => (stores[0]!.status = 'archived'),
    () => (stores[0]!.archivedAt = new Date()),
    () => stores.splice(0, 1),
    () => (users[0]!.accountStatus = 'suspended'),
    () => (users[0]!.accountStatus = 'blocked'),
  ];
  const keep = { stores: structuredClone(stores), users: structuredClone(users) };
  for (const change of cases) {
    stores = structuredClone(keep.stores);
    users = structuredClone(keep.users);
    change();
    const res = await getProducts();
    assert.equal(res.status, 403, change.toString());
    assert.equal(await errorCode(res), 'STORE_UNAVAILABLE');
  }
  assert.equal(selects.product, undefined);
});

test('a plan that no longer includes API keys (limit 0) is 403 PLAN_LIMIT_REACHED; unlimited and fewer keys still read', async () => {
  keyLimit = 0;
  const res = await getOrders();
  assert.equal(res.status, 403);
  assert.equal(await errorCode(res), 'PLAN_LIMIT_REACHED');
  assert.equal(selects.order, undefined);
  for (const limit of [null, 1]) {
    keyLimit = limit;
    assert.equal((await getOrders()).status, 200, String(limit));
  }
});

test('the rate limit is per key id: 429 with Retry-After, before the scope answer; another key is free; a wrong secret does not use up a key', async () => {
  const wrongSecret = 'Bearer mkz_live_' + tokenA.prefix + '_' + generateApiKey().token.slice(-43);
  for (let i = 0; i < 130; i += 1) assert.equal((await getProducts({ auth: wrongSecret })).status, 401);
  assert.equal((await getProducts()).status, 200);

  for (let i = 0; i < 120; i += 1) await limitApiKey(KEY_A);
  const limited = await getProducts();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal(await errorCode(limited), 'RATE_LIMITED');
  keys[0]!.scopes = ['products:read'];
  assert.equal((await getOrders()).status, 429);
  assert.equal((await getProducts({ auth: bearerB() })).status, 200);
});

test('lastUsedAt is written at most once a minute, and not for a refused request', async () => {
  keyLimit = 0;
  await getProducts();
  assert.equal(touches.length, 0);
  keyLimit = 2;
  await getProducts();
  await getProducts();
  await getOrders();
  assert.equal(touches.length, 1);
  keys[0]!.lastUsedAt = new Date(Date.now() - 61_000);
  await getProducts();
  assert.equal(touches.length, 2);
});

test('products: the frozen field names, whole rupees, stock over the variants, ISO dates, pictures in order without videos, no internal field', async () => {
  const body = await json(await getProducts());
  assert.equal(apiV1ProductListSchema.safeParse(body).success, true, JSON.stringify(body));
  const first = body.data.find((p: Row) => p.id === id('a', 1));
  assert.deepEqual(first, {
    id: id('a', 1),
    name: 'Product a1',
    slug: 'product-a1',
    description: 'Cotton',
    price: 500,
    comparePrice: 650,
    stock: 7,
    status: 'published',
    category: { id: CAT_A, name: 'Shirts', slug: 'shirts' },
    images: [{ url: 'https://cdn.test/2.jpg', alt: 'back' }, { url: 'https://cdn.test/1.jpg', alt: 'front' }],
    updatedAt: at(1).toISOString(),
  });
  assert.doesNotMatch(JSON.stringify(body), /internal-tag|viewCount|deliveryCharge|variants|"store"/);

  products[0]!.variants[0].trackQuantity = false;
  products[0]!.isPublished = false;
  const one = await json(await getProduct(id('a', 1)));
  assert.equal(apiV1ProductDetailSchema.safeParse(one).success, true);
  assert.equal(one.data.stock, null);
  assert.equal(one.data.status, 'draft');
  products[0]!.moderation = { state: 'takedown', reason: 'secret reason' };
  const taken = await json(await getProduct(id('a', 1)));
  assert.equal(taken.data.status, 'taken_down');
  assert.doesNotMatch(JSON.stringify(taken), /secret reason/);
});

test('orders: the frozen field names and the city only; no customer name, phone, email, address or note is read or answered', async () => {
  const listRes = await getOrders();
  const listText = await listRes.text();
  const detailText = await (await getOrder(id('a', 101))).text();
  for (const text of [listText, detailText]) {
    for (const value of PII) assert.equal(text.includes(value), false, value);
    assert.doesNotMatch(text, /customer|phone|email|address|"notes"/i);
  }
  assert.equal(apiV1OrderListSchema.safeParse(JSON.parse(listText)).success, true, listText);
  const detail = JSON.parse(detailText);
  assert.equal(apiV1OrderDetailSchema.safeParse(detail).success, true, detailText);
  assert.deepEqual(detail.data, {
    id: id('a', 101),
    orderId: 'MKZ-A1',
    status: 'confirmed',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    items: [{ productId: id('a', 1), variantId: 'v1', name: 'Shirt', variantName: 'Large', sku: 'SH-L', unitPrice: 500, quantity: 2 }],
    subtotal: 1000,
    deliveryCharges: 200,
    discount: 100,
    taxAmount: 0,
    total: 1100,
    city: 'Lahore',
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
  });
  assert.ok(selects.order!.length >= 2);
  for (const fields of selects.order!) assert.doesNotMatch(fields, /customer|phone|address|notes/i, 'never even read');
  assert.equal(listRes.headers.get('cache-control'), 'no-store');
});

test('an order from before tax, discounts and payment states reads with zeros and unpaid', async () => {
  orders = [order('a', 1, { taxAmount: undefined, discountAmount: undefined, paymentStatus: undefined, paymentMethod: undefined, city: undefined })];
  const body = await json(await getOrders());
  assert.deepEqual(
    [body.data[0].taxAmount, body.data[0].discount, body.data[0].paymentStatus, body.data[0].paymentMethod, body.data[0].city],
    [0, 0, 'unpaid', null, null],
  );
});

test('paging: newest first by cursor, every record once, also when two share a creation time; nextCursor is null on the last page', async () => {
  orders = [order('a', 1), order('a', 2), order('a', 3), order('a', 4, { createdAt: at(3) }), order('a', 5), order('b', 6)];
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const body: any = await json(await getOrders({ query: '?limit=2' + (cursor === null ? '' : '&cursor=' + cursor) }));
    seen.push(...body.data.map((o: Row) => o.orderId));
    cursor = body.nextCursor;
    pages += 1;
  } while (cursor !== null && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, ['MKZ-A5', 'MKZ-A4', 'MKZ-A3', 'MKZ-A2', 'MKZ-A1']);
});

test('updatedSince keeps the records changed at or after the instant, in lists of both kinds', async () => {
  orders = [order('a', 1, { updatedAt: at(25) }), order('a', 2), order('a', 3)];
  const body = await json(await getOrders({ query: '?updatedSince=' + at(3).toISOString() }));
  assert.deepEqual(body.data.map((o: Row) => o.orderId), ['MKZ-A3', 'MKZ-A1']);
  const goods = await json(await getProducts({ query: '?updatedSince=2026-11-02T15:00:00%2B05:00' }));
  assert.deepEqual(goods.data.map((p: Row) => p.id), [id('a', 2)]);
});

test('a bad limit, cursor or updatedSince is 400 and names the field; the largest page is 100', async () => {
  for (const [queryString, field] of [['?limit=0', 'limit'], ['?limit=101', 'limit'], ['?limit=ten', 'limit'], ['?cursor=zzz', 'cursor'], ['?cursor=%24', 'cursor'], ['?updatedSince=yesterday', 'updatedSince'], ['?updatedSince=2026-11-01', 'updatedSince']]) {
    for (const res of [await getProducts({ query: queryString }), await getOrders({ query: queryString })]) {
      assert.equal(res.status, 400, queryString);
      const body = await json(res);
      assert.deepEqual([body.error.code, body.error.field], ['INVALID_REQUEST', field], queryString);
    }
  }
  assert.equal((await getProducts({ query: '?limit=100' })).status, 200);
});

test('v1 is GET only (Next answers 405 for a method a route does not export), and no middleware asks it for a session', async () => {
  for (const path of ['products', 'products/[id]', 'orders', 'orders/[id]']) {
    const route = (await import('../src/app/api/v1/' + path + '/route')) as Record<string, unknown>;
    assert.equal(typeof route.GET, 'function', path);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(route[method], undefined, path + ' ' + method);
  }
  for (const file of ['middleware.ts', join('src', 'middleware.ts')]) assert.equal(existsSync(join(process.cwd(), file)), false, 'the backend has no middleware');
  const portal = readFileSync(join(process.cwd(), '..', 'frontend', 'middleware.ts'), 'utf8');
  assert.match(portal, /matcher: \['\/\(\(\?!api\|/, 'the portal middleware leaves /api alone');
});

test('docs/api-v1.md lists every field of the frozen contracts (the served copy is held identical by the portal test)', () => {
  const docs = readFileSync(join(process.cwd(), '..', '..', '..', 'docs', 'api-v1.md'), 'utf8');
  for (const schema of [apiV1ProductSchema, apiV1OrderSchema]) {
    for (const field of Object.keys(schema.shape)) assert.ok(docs.includes('| `' + field + '` |'), field);
  }
});
