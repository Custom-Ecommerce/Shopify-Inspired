import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { AuditLog, CustomerNote, EmailUnsubscribe, Order, Product, Return, SellerAlert, signSession, StockMovement, Store, User } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setSessionUserLoader } from '@/lib/session-user';
import { setMembershipListLoader, setMembershipLoader } from '@/lib/data-plane';
import { IDEMPOTENCY_STALE_MS, setIdempotencyStore, type IdempotencyRow, type IdempotencyStore } from '@/lib/idempotency';

// Sprint 9 (EP-31.US03): the phone's read API, the idempotent writes and the conflicts. Models are small in-memory fakes; no database. Every answer is
// checked against the frozen contract schemas.

const contracts = unwrapCjs(contractsNs) as typeof contractsNs;

const SECRET = 'd'.repeat(40);
const OWNER = '65a000000000000000000001';
const STRANGER = '65a000000000000000000002';
const HELPER = '65a000000000000000000003';
const STORE = '65b000000000000000000001';
const OTHER_STORE = '65b000000000000000000002';
const ORDER = '65c000000000000000000001';
const FOREIGN_ORDER = '65c000000000000000000099';
const PRODUCT = '65d000000000000000000001';
const VARIANT = '65e000000000000000000001';
const VARIANT2 = '65e000000000000000000002';
const T0 = new Date('2026-11-20T10:00:00.000Z');

type Row = Record<string, any>;
let orders: Row[];
let products: Row[];
let alerts: Row[];
let audits: Row[];
let movements: Row[];
let records: Map<string, IdempotencyRow>;
let clock = T0.getTime();
let restore: () => void = () => {};
let routes: Record<string, any>;
let token: Record<string, string>;

const tick = () => new Date((clock += 1000));

const same = (a: unknown, b: unknown): boolean => (a instanceof Date || b instanceof Date ? new Date(a as never).getTime() === new Date(b as never).getTime() : String(a) === String(b));
const read = (row: Row, path: string): any => path.split('.').reduce((value: any, key) => value?.[key], row);
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, wanted]: [string, any]) => {
    const actual = read(row, key);
    if (wanted === null) return actual === null || actual === undefined;
    if (wanted instanceof RegExp) return wanted.test(String(actual));
    if (typeof wanted === 'object' && !(wanted instanceof Date) && !(wanted instanceof mongoose.Types.ObjectId)) {
      return Object.entries(wanted).every(([op, value]: [string, any]) => {
        if (op === '$gte') return actual >= value;
        if (op === '$lte') return actual <= value;
        if (op === '$ne') return !same(actual, value);
        if (op === '$in') return value.some((v: unknown) => same(actual, v));
        if (op === '$nin') return !value.some((v: unknown) => same(actual, v));
        if (op === '$exists') return (actual !== undefined) === value;
        if (op === '$elemMatch') return (actual ?? []).some((entry: Row) => matches(entry, value));
        if (op === '$regex') return new RegExp(value, wanted.$options).test(String(actual ?? ''));
        if (op === '$options') return true;
        throw new Error('fake model: unsupported operator ' + op);
      });
    }
    return same(actual, wanted);
  });
}

const query = (value: () => any) => {
  let skip = 0;
  let limit = Infinity;
  let sort: Record<string, 1 | -1> | null = null;
  const q: any = {
    select: () => q,
    populate: () => q,
    sort: (s: Record<string, 1 | -1>) => ((sort = s), q),
    skip: (n: number) => ((skip = n), q),
    limit: (n: number) => ((limit = n), q),
    allowDiskUse: () => q,
    lean: async () => {
      const out = value();
      if (!Array.isArray(out)) return out ? structuredClone(out) : out;
      const rows = [...out];
      if (sort) rows.sort((a, b) => Object.entries(sort!).reduce((d, [k, dir]) => d || (String(read(a, k) instanceof Date ? read(a, k).toISOString() : read(a, k)).localeCompare(String(read(b, k) instanceof Date ? read(b, k).toISOString() : read(b, k))) * dir), 0));
      return structuredClone(rows.slice(skip, skip + limit));
    },
  };
  return q;
};

const orderRow = (n: number, over: Row = {}): Row => ({
  _id: '65c0000000000000000' + String(n).padStart(5, '0'),
  store: STORE,
  orderId: 'ORD-' + String(1000 + n),
  status: 'pending',
  paymentMethod: 'cod',
  paymentStatus: 'unpaid',
  customerName: 'Ayesha',
  phone: '+923001234567',
  city: 'Lahore',
  total: 1000 + n,
  items: [{ productTitle: 'Shawl', variantTitle: 'Default', quantity: 1, unitPrice: 1000 + n }],
  statusHistory: [],
  notes: [],
  createdAt: new Date(T0.getTime() - n * 60_000),
  updatedAt: new Date(T0.getTime() - n * 60_000),
  ...over,
});

const productRow = (): Row => ({
  _id: PRODUCT,
  store: STORE,
  title: 'Shawl',
  slug: 'shawl',
  isPublished: true,
  minPrice: 1500,
  options: [{ name: 'Size', values: ['S', 'M'] }],
  variants: [
    { _id: VARIANT, title: 'S', price: 1500, compareAtPrice: null, trackQuantity: true, stockQuantity: 10, optionValues: ['S'], position: 0 },
    { _id: VARIANT2, title: 'M', price: 1600, compareAtPrice: null, trackQuantity: false, stockQuantity: 0, optionValues: ['M'], position: 1 },
  ],
  media: [],
  deletedAt: null,
  createdAt: T0,
  updatedAt: T0,
});

const memoryIdempotency: IdempotencyStore = {
  claim: async (user, key, _route, requestHash, now) => {
    if (records.has(user + key)) return false;
    records.set(user + key, { requestHash, state: 'pending', responseStatus: null, responseBody: null, startedAt: now });
    return true;
  },
  find: async (user, key) => records.get(user + key) ?? null,
  takeOver: async (user, key, before, now) => {
    const row = records.get(user + key);
    if (!row || row.state !== 'pending' || !(row.startedAt < before)) return false;
    row.startedAt = now;
    return true;
  },
  finish: async (user, key, status, body) => void Object.assign(records.get(user + key)!, { state: 'done', responseStatus: status, responseBody: body }),
  release: async (user, key) => {
    if (records.get(user + key)?.state === 'pending') records.delete(user + key);
  },
};

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  const load = async (path: string) => (await import('../src/app/api/mobile/v1/' + path + '/route')) as any;
  routes = {
    stores: (await load('stores')).GET,
    dashboard: (await load('dashboard')).GET,
    orders: (await load('orders')).GET,
    order: (await load('orders/[id]')).GET,
    status: (await load('orders/[id]/status')).POST,
    note: (await load('orders/[id]/notes')).POST,
    products: (await load('products')).GET,
    product: (await load('products/[id]')).GET,
    stock: (await load('products/[id]/stock')).POST,
    price: (await load('products/[id]/price')).POST,
    customers: (await load('customers')).GET,
    alerts: (await load('alerts')).GET,
    customer: (await load('customers/[key]')).GET,
    alertRead: (await load('alerts/[id]/read')).POST,
    alertReadAll: (await load('alerts/read-all')).POST,
  };
  token = {
    owner: await signSession({ sub: OWNER, role: 'seller' }, SECRET, SELLER_AUDIENCE),
    stranger: await signSession({ sub: STRANGER, role: 'seller' }, SECRET, SELLER_AUDIENCE),
    helper: await signSession({ sub: HELPER, role: 'seller' }, SECRET, SELLER_AUDIENCE),
    admin: await signSession({ sub: OWNER, role: 'admin' }, SECRET, SELLER_AUDIENCE),
  };
});

const saved: Array<[any, string, unknown]> = [];
const stub = (target: any, name: string, value: unknown) => {
  saved.push([target, name, target[name]]);
  target[name] = value;
};

beforeEach(() => {
  clock = T0.getTime();
  orders = [orderRow(1, { _id: ORDER }), orderRow(2, { status: 'delivered', createdAt: new Date(), total: 4000 }), orderRow(3, { confirmationStatus: 'unconfirmed' }), { ...orderRow(99), _id: FOREIGN_ORDER, store: OTHER_STORE }];
  products = [productRow()];
  alerts = [
    { _id: '65f000000000000000000001', store: STORE, kind: 'new_order', title: 'New order', body: 'x', link: '/orders', readAt: null, createdAt: T0, updatedAt: T0 },
    { _id: '65f000000000000000000002', store: STORE, kind: 'low_stock', title: 'Low', body: 'y', link: '/inventory', readAt: null, createdAt: T0, updatedAt: T0 },
  ];
  audits = [];
  movements = [];
  records = new Map();
  setIdempotencyStore(memoryIdempotency);
  setSessionUserLoader(async (id) => ({ role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: null }), { ttlMs: 0 });
  setSessionUserLoader(async () => ({ role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: null }), { ttlMs: 0 });
  setMembershipLoader(async (storeId, userId) => (storeId === STORE && userId === HELPER ? { role: 'support' } : null));
  setMembershipListLoader(async () => []);

  stub(mongoose as any, 'connect', async () => mongoose);
  stub(Store, 'exists', async (f: Row) => (String(f.owner) === OWNER && f._id === STORE ? { _id: STORE } : null));
  stub(Store, 'find', (f: Row) => query(() => (f.owner ? (String(f.owner) === OWNER ? [{ _id: STORE, name: 'Zara', slug: 'zara', status: 'active', updatedAt: T0 }] : []) : [{ _id: STORE, updatedAt: T0 }])));
  stub(Store, 'countDocuments', async () => 1);
  stub(User, 'findById', () => query(() => ({ _id: OWNER, name: 'Ayesha', email: 'a@x.test' })));

  stub(Order, 'findOne', (f: Row) => query(() => orders.find((o) => matches(o, f)) ?? null));
  stub(Order, 'find', (f: Row) => query(() => orders.filter((o) => matches(o, f))));
  stub(Order, 'countDocuments', async (f: Row) => orders.filter((o) => matches(o, f)).length);
  stub(Order, 'findOneAndUpdate', (f: Row, update: Row) =>
    query(() => {
      const row = orders.find((o) => matches(o, f));
      if (!row) return null;
      Object.assign(row, update.$set ?? {});
      for (const [k, v] of Object.entries(update.$push ?? {})) (row[k] ??= []).push({ _id: new mongoose.Types.ObjectId().toString(), ...(v as Row) });
      row.updatedAt = tick();
      return row;
    }),
  );
  stub(Order, 'aggregate', (pipeline: Row[]) => {
    const match = pipeline[0]!.$match;
    const scoped = () => orders.filter((o) => matches(o, match));
    const result = (): any[] => {
      // The customer page: first the one customer's group, then their order lines. Only +923001234567 exists.
      const wanted = pipeline.find((s) => s.$match?._key !== undefined)?.$match._key;
      if (wanted !== undefined && !pipeline.some((s) => s.$facet)) {
        if (typeof wanted !== 'string' || wanted !== '+923001234567') return [];
        if (pipeline.some((s) => s.$project?.orderId)) return orders.filter((o) => same(o.store, match.store)).map((o) => ({ ...o }));
        return [{ _id: wanted, name: 'Ayesha', phone: wanted, orders: 3, deliveredCount: 1, totalSpent: 4000, firstOrderAt: T0, lastOrderAt: T0 }];
      }
      if (pipeline.some((s) => s.$facet)) {
        return [{ rows: [{ _id: '+923001234567', name: 'Ayesha', phone: '+923001234567', orderCount: 3, deliveredCount: 1, totalSpent: 4000, lastOrderAt: T0 }], total: [{ n: 1 }] }];
      }
      const group = pipeline[1]!.$group;
      if (group._id && typeof group._id === 'object' && 'day' in group._id) {
        // The analytics page's rows by day and status.
        return scoped().map((o) => ({ _id: { day: new Date(o.createdAt).toISOString().slice(0, 10), status: o.status }, count: 1, total: o.total }));
      }
      if (group._id === null) return [{ _id: null, total: scoped().reduce((sum, o) => sum + o.total, 0) }];
      return [...new Set(scoped().map((o) => o.status))].map((status) => ({ _id: status, count: scoped().filter((o) => o.status === status).length }));
    };
    const done: any = Promise.resolve(result());
    done.allowDiskUse = () => done;
    return done;
  });

  stub(Product, 'findOne', (f: Row) => query(() => products.find((p) => matches(p, f)) ?? null));
  stub(Product, 'find', (f: Row) => query(() => products.filter((p) => matches(p, f))));
  stub(Product, 'countDocuments', async (f: Row) => products.filter((p) => matches(p, f)).length);
  stub(Product, 'exists', async () => null);
  stub(Product, 'findOneAndUpdate', (f: Row, update: any) =>
    query(() => {
      const { 'variants._id': _all, ...rest } = f;
      const row = products.find((p) => matches(p, rest));
      if (!row) return null;
      if (Array.isArray(update)) {
        // The portal's update pipeline: apply the literal price of each rewritten variant and the new minPrice.
        const set = update[0].$set;
        row.minPrice = set.minPrice.$literal;
        set.variants.forEach((expression: any, i: number) => Object.assign(row.variants[i], { price: expression.$mergeObjects[0].$literal.price, compareAtPrice: expression.$mergeObjects[0].$literal.compareAtPrice }));
      } else {
        const wanted = f.variants.$elemMatch._id;
        row.variants.find((v: Row) => v._id === wanted).stockQuantity += update.$inc['variants.$.stockQuantity'];
      }
      row.updatedAt = tick();
      return row;
    }),
  );
  stub(StockMovement, 'create', async (doc: Row) => void movements.push(doc));
  stub(SellerAlert, 'find', (f: Row) => query(() => alerts.filter((a) => matches(a, f))));
  stub(SellerAlert, 'countDocuments', async (f: Row) => alerts.filter((a) => matches(a, f)).length);
  stub(SellerAlert, 'findOne', (f: Row) => query(() => alerts.find((a) => matches(a, f)) ?? null));
  stub(SellerAlert, 'findOneAndUpdate', (f: Row, update: Row) =>
    query(() => {
      const row = alerts.find((a) => matches(a, f));
      if (row) Object.assign(row, update.$set);
      return row ?? null;
    }),
  );
  stub(SellerAlert, 'updateMany', async (f: Row, update: Row) => {
    const found = alerts.filter((a) => matches(a, f));
    found.forEach((a) => Object.assign(a, update.$set));
    return { modifiedCount: found.length };
  });
  stub(Return, 'countDocuments', async () => 0);
  stub(CustomerNote, 'find', () => query(() => []));
  stub(EmailUnsubscribe, 'find', () => query(() => []));
  stub(AuditLog, 'create', async (doc: Row) => (audits.push(doc), { _id: new mongoose.Types.ObjectId() }));
  restore = () => {
    for (const [target, name, value] of saved.splice(0).reverse()) target[name] = value;
  };
});

afterEach(() => {
  restore();
  setIdempotencyStore(null);
  setSessionUserLoader(null);
  setMembershipLoader(null);
  setMembershipListLoader(null);
});

interface Call {
  who?: string;
  store?: string | null;
  id?: string;
  query?: string;
  body?: unknown;
  key?: string | null;
  params?: Record<string, string>;
}
async function call(name: string, options: Call = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const method = options.body === undefined ? 'GET' : 'POST';
  const headers: Record<string, string> = { authorization: 'Bearer ' + token[options.who ?? 'owner'], 'content-type': 'application/json' };
  if (options.store !== null) headers['x-store-id'] = options.store ?? STORE;
  if (options.key) headers['idempotency-key'] = options.key;
  const request = new NextRequest('http://seller.test/api/mobile/v1/x' + (options.query ?? ''), { method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const response: Response = await routes[name](request, { params: Promise.resolve(options.params ?? { id: options.id ?? '' }) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const valid = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown) => {
  const parsed = schema.safeParse(value);
  assert.ok(parsed.success, JSON.stringify(parsed.error));
};
let keys = 0;
const key = () => 'key-' + String((keys += 1)).padStart(8, '0');

// ------------------------------------------------------------------------------------------------------- reads (T01, T04)

test('stores: only the stores the seller can read, with the role and a revision', async () => {
  const mine = await call('stores', { store: null });
  assert.equal(mine.status, 200);
  valid(contracts.mobileStoreListSchema, mine.body);
  assert.deepEqual(mine.body.stores.map((s: any) => [s.id, s.role, s.revision]), [[STORE, 'owner', T0.getTime()]]);
  assert.deepEqual((await call('stores', { who: 'stranger', store: null })).body.stores, []);
  assert.equal((await call('stores', { who: 'admin', store: null })).status, 401);
});

test('dashboard: the portal numbers; money only for the owner and stock only for roles that read products', async () => {
  const owner = await call('dashboard');
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  valid(contracts.mobileDashboardSchema, owner.body);
  assert.deepEqual([owner.body.pendingOrders, owner.body.unconfirmedOrders, owner.body.lowStockProducts, owner.body.revenueThisMonth], [2, 1, 0, 4000]);
  assert.equal(owner.body.recentOrders.length, 3);
  const support = await call('dashboard', { who: 'helper' });
  assert.equal(support.status, 200);
  assert.deepEqual([support.body.revenueThisMonth, support.body.lowStockProducts], [null, null]);
});

test('dashboard: today and week sales follow the analytics rules, and only roles with analytics see them', async () => {
  const day = 86_400_000;
  const now = Date.now();
  orders.splice(
    0,
    orders.length,
    orderRow(1, { total: 100, createdAt: new Date(now) }),
    orderRow(2, { total: 200, status: 'delivered', createdAt: new Date(now - 2 * day) }),
    orderRow(3, { total: 400, status: 'cancelled', createdAt: new Date(now) }),
    orderRow(4, { total: 800, status: 'returned', createdAt: new Date(now) }),
    orderRow(5, { total: 1600, createdAt: new Date(now - 9 * day) }),
  );
  const owner = await call('dashboard');
  valid(contracts.mobileDashboardSchema, owner.body);
  assert.deepEqual([owner.body.salesToday, owner.body.salesThisWeek], [100, 300]);
  const support = await call('dashboard', { who: 'helper' });
  assert.deepEqual([support.body.salesToday, support.body.salesThisWeek], [null, null]);
});

test('orders: the payment filter narrows to cash on delivery or to received money, in the list and the counts', async () => {
  orders.splice(
    0,
    orders.length,
    orderRow(1),
    orderRow(2, { paymentMethod: 'card', paymentStatus: 'paid' }),
    orderRow(3, { status: 'delivered', paymentStatus: 'collected' }),
    orderRow(4, { paymentMethod: 'card' }),
  );
  const ids = (body: any) => body.docs.map((o: any) => o.orderId).sort();
  const cod = await call('orders', { query: '?payment=cod' });
  assert.equal(cod.status, 200, JSON.stringify(cod.body));
  assert.deepEqual(ids(cod.body), ['ORD-1001', 'ORD-1003']);
  const paid = await call('orders', { query: '?payment=paid' });
  assert.deepEqual(ids(paid.body), ['ORD-1002', 'ORD-1003']);
  assert.equal(paid.body.counts.all, 2);
  assert.equal((await call('orders', { query: '?payment=free' })).status, 400);
  assert.equal((await call('orders', { query: '?payment=paid', store: OTHER_STORE })).status, 403);
});

test('customer detail: the website page for one customer of this store, by the key of the list', async () => {
  const found = await call('customer', { id: '', params: { key: '+923001234567' } });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  valid(contracts.mobileCustomerDetailSchema, found.body);
  assert.equal(found.body.stats.orderCount, 3);
  assert.ok(found.body.orders.length > 0 && found.body.orders.every((o: any) => o.orderId.startsWith('ORD-')));
  assert.equal(found.headers.get('cache-control'), 'no-store');
  assert.equal((await call('customer', { params: { key: '+923009999999' } })).status, 404);
  assert.equal((await call('customer', { params: { key: 'nobody' } })).status, 400);
  assert.equal((await call('customer', { who: 'stranger', params: { key: '+923001234567' } })).status, 403);
  assert.equal((await call('customer', { store: OTHER_STORE, params: { key: '+923001234567' } })).status, 403);
  assert.equal((await call('customer', { store: null, params: { key: '+923001234567' } })).status, 400);
  assert.equal((await call('customer', { who: 'helper', params: { key: '+923001234567' } })).status, 200, 'support reads customers');
});

test('alerts: mark one or all read, only what the store and role see', async () => {
  const first = '65f000000000000000000001';
  const one = await call('alertRead', { id: first, body: {} });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.deepEqual(one.body, { id: first, unread: 1 });
  assert.equal((await call('alertRead', { id: first, body: {} })).body.unread, 1, 'repeating changes nothing');
  assert.equal((await call('alertRead', { id: '65f000000000000000000099', body: {} })).status, 404);
  assert.equal((await call('alertRead', { id: first, who: 'stranger', body: {} })).status, 403);
  assert.equal((await call('alertReadAll', { store: OTHER_STORE, body: {} })).status, 403);
  const all = await call('alertReadAll', { body: {} });
  assert.equal(all.status, 200);
  assert.equal(all.body.unread, 0);
});

test('every read needs the store the app chose; a foreign store is 403, a foreign record 404', async () => {
  for (const name of ['dashboard', 'orders', 'products', 'customers', 'alerts']) {
    const missing = await call(name, { store: null });
    assert.equal(missing.status, 400, name);
    assert.equal(missing.body.code, 'STORE_ID_REQUIRED', name);
    assert.equal((await call(name, { who: 'stranger' })).status, 403, name);
    assert.equal((await call(name, { store: OTHER_STORE })).status, 403, name);
  }
  assert.equal((await call('order', { id: FOREIGN_ORDER })).status, 404);
  assert.equal((await call('order', { id: 'nonsense' })).status, 404);
  assert.equal((await call('product', { id: '65d000000000000000000099' })).status, 404);
});

test('role isolation: support reads orders, customers and alerts, never products', async () => {
  for (const name of ['orders', 'customers', 'alerts']) assert.equal((await call(name, { who: 'helper' })).status, 200, name);
  for (const [name, options] of [['products', {}], ['product', { id: PRODUCT }]] as const) {
    const refused = await call(name, { who: 'helper', ...options });
    assert.equal(refused.status, 403, name);
    assert.equal(refused.body.code, 'CAPABILITY_DENIED');
  }
  const bell = await call('alerts', { who: 'helper' });
  assert.deepEqual(bell.body.docs.map((a: any) => a.kind), ['new_order'], 'support does not see stock alerts');
});

test('order list: filters and paging lose nothing, the page is capped at 50, and every row carries revision and updatedAt', async () => {
  orders = Array.from({ length: 120 }, (_, i) => orderRow(i + 1, { status: i % 3 === 0 ? 'delivered' : 'pending' }));
  const seen = new Set<string>();
  let page = 1;
  for (;;) {
    const res = await call('orders', { query: '?limit=500&page=' + page });
    assert.equal(res.status, 200);
    valid(contracts.mobileOrderListSchema, res.body);
    assert.ok(res.body.docs.length <= 50);
    assert.equal(res.body.limit, 50);
    for (const doc of res.body.docs) {
      assert.ok(doc.revision > 0 && doc.updatedAt);
      seen.add(doc.id);
    }
    if (page >= res.body.totalPages) break;
    page += 1;
  }
  assert.equal(seen.size, 120);
  const delivered = await call('orders', { query: '?status=delivered&limit=50' });
  assert.equal(delivered.body.totalDocs, 40);
  assert.equal(delivered.body.counts.all, 120);
  assert.equal((await call('orders', { query: '?status=nonsense' })).body.errors[0].code, 'ORDER_STATUS_INVALID');
  const legacy = await call('orders', { query: '?where=%7B%22store%22%3A%7B%22equals%22%3A%22x%22%7D%7D&sort=total' });
  assert.equal(legacy.status, 200, 'the generic where and sort are ignored');
  assert.equal(legacy.body.totalDocs, 120);
});

test('details, products, customers and alerts answer the contract shapes, each record with a revision', async () => {
  const order = await call('order', { id: ORDER });
  valid(contracts.mobileOrderDetailSchema, order.body);
  assert.equal(order.body.revision, orders[0]!.updatedAt.getTime());
  const list = await call('products');
  valid(contracts.mobileProductListSchema, list.body);
  const product = await call('product', { id: PRODUCT });
  valid(contracts.mobileProductDetailSchema, product.body);
  assert.deepEqual(product.body.variants.map((v: any) => v.revision), [T0.getTime(), T0.getTime()], 'a variant has its product revision');
  const customers = await call('customers', { query: '?limit=900' });
  assert.equal(customers.status, 200, JSON.stringify(customers.body));
  valid(contracts.mobileCustomerListSchema, customers.body);
  assert.equal(customers.body.limit, 50);
  const bell = await call('alerts');
  valid(contracts.mobileAlertListSchema, bell.body);
  assert.equal(bell.body.unread, 2);
});

// ------------------------------------------------------------------------------------------------- writes (T02, T03)

const confirm = (revision: number, more: Record<string, unknown> = {}) => ({ revision, status: 'confirmed', ...more });
const rev = () => orders[0]!.updatedAt.getTime();

test('a status change on the revision the app saw: one write, the new record, one audit line', async () => {
  const res = await call('status', { id: ORDER, body: confirm(rev()), key: key() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, true);
  assert.equal(res.body.order.status, 'confirmed');
  assert.equal(res.body.order.revision, rev(), 'the re-read revision');
  valid(contracts.mobileOrderDetailSchema, res.body.order);
  assert.equal(orders[0]!.statusHistory.length, 1);
  assert.equal(audits.length, 1);
});

test('a moved revision is 409 CONFLICT with the current record and nothing is written', async () => {
  const seen = rev();
  orders[0]!.updatedAt = tick();
  const res = await call('status', { id: ORDER, body: confirm(seen), key: key() });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONFLICT');
  assert.equal(res.body.current.id, ORDER);
  assert.equal(res.body.current.revision, rev());
  valid(contracts.mobileConflictSchema, res.body);
  assert.equal(orders[0]!.status, 'pending');
  assert.equal(audits.length, 0);
});

test('an order already in the wanted status is a 200 that changes nothing, whatever the revision', async () => {
  orders[0]!.status = 'confirmed';
  const res = await call('status', { id: ORDER, body: confirm(1), key: key() });
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, false);
  assert.equal(orders[0]!.statusHistory.length, 0);
});

test('the portal rules still hold on the phone: an illegal move is 422, a dispatch needs the courier', async () => {
  const illegal = await call('status', { id: ORDER, body: { revision: rev(), status: 'delivered' }, key: key() });
  assert.equal(illegal.status, 422);
  assert.equal(illegal.body.errors[0].code, 'ORDER_TRANSITION_ILLEGAL');
  const noCourier = await call('status', { id: ORDER, body: { revision: rev(), status: 'dispatched' }, key: key() });
  assert.equal(noCourier.status, 400);
  assert.equal((await call('status', { id: ORDER, body: { status: 'confirmed' }, key: key() })).status, 400, 'revision is required');
});

test('every write needs an Idempotency-Key', async () => {
  const bodies: Array<[string, string, unknown]> = [
    ['status', ORDER, confirm(rev())],
    ['note', ORDER, { revision: rev(), text: 'call after 5' }],
    ['stock', PRODUCT, { revision: T0.getTime(), variantId: VARIANT, quantity: 3 }],
    ['price', PRODUCT, { revision: T0.getTime(), variantId: VARIANT, price: 1700 }],
  ];
  for (const [name, id, body] of bodies) {
    for (const bad of [null, 'short', 'has spaces in it!']) {
      const res = await call(name, { id, body, key: bad });
      assert.equal(res.status, 400, name + ' ' + bad);
      assert.equal(res.body.code, 'IDEMPOTENCY_KEY_REQUIRED');
    }
  }
  assert.equal(orders[0]!.status, 'pending');
  assert.equal(products[0]!.variants[0].stockQuantity, 10);
});

test('the same key and body replays the stored answer without doing the work again; another body with that key is 422', async () => {
  const k = key();
  const body = { revision: rev(), text: 'call after 5' };
  const first = await call('note', { id: ORDER, body, key: k });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await call('note', { id: ORDER, body: { text: 'call after 5', revision: body.revision }, key: k });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(again.body, first.body);
  assert.equal(orders[0]!.notes.length, 1, 'one note, not two');
  assert.equal(audits.length, 1);
  const other = await call('note', { id: ORDER, body: { revision: body.revision, text: 'something else' }, key: k });
  assert.equal(other.status, 422);
  assert.equal(other.body.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await call('status', { id: ORDER, body: confirm(rev()), key: k })).status, 422, 'also across routes');
});

test('two parallel requests with one key do the work once', async () => {
  const k = key();
  const body = { revision: rev(), text: 'parallel' };
  const results = await Promise.all([call('note', { id: ORDER, body, key: k }), call('note', { id: ORDER, body, key: k })]);
  const statuses = results.map((r) => r.status).sort();
  assert.ok(statuses.join() === '200,409' || statuses.join() === '200,200', statuses.join());
  if (statuses[1] === 409) assert.equal(results.find((r) => r.status === 409)!.body.code, 'IDEMPOTENCY_IN_PROGRESS');
  assert.equal(orders[0]!.notes.length, 1);
});

test('a row left pending by a dead process is taken over after a minute, and the moved revision stops a second apply', async () => {
  const k = key();
  const body = { revision: rev(), text: 'once only' };
  assert.equal((await call('note', { id: ORDER, body, key: k })).status, 200);
  const stored = records.get(OWNER + k)!;
  Object.assign(stored, { state: 'pending', responseBody: null, responseStatus: null, startedAt: new Date() });
  assert.equal((await call('note', { id: ORDER, body, key: k })).body.code, 'IDEMPOTENCY_IN_PROGRESS');
  stored.startedAt = new Date(Date.now() - IDEMPOTENCY_STALE_MS - 1000);
  const retried = await call('note', { id: ORDER, body, key: k });
  assert.equal(retried.status, 409);
  assert.equal(retried.body.code, 'CONFLICT');
  assert.equal(orders[0]!.notes.length, 1);
});

test('an answer that may differ next time is not kept: the same key runs again', async () => {
  const k = key();
  const body = confirm(rev());
  stub(Order, 'findOneAndUpdate', () => {
    throw new Error('database down');
  });
  const saved500 = console.error;
  console.error = () => {};
  try {
    assert.equal((await call('status', { id: ORDER, body, key: k })).status, 500);
  } finally {
    console.error = saved500;
  }
  assert.equal(records.size, 0);
});

test('stock: an absolute count on the product revision; a sale in between is a conflict showing the real count', async () => {
  const ok = await call('stock', { id: PRODUCT, body: { revision: T0.getTime(), variantId: VARIANT, quantity: 7 }, key: key() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.changed, true);
  assert.equal(ok.body.product.variants[0].stockQuantity, 7);
  assert.deepEqual([movements.length, movements[0]!.delta, movements[0]!.reason], [1, -3, 'Stock count on the phone']);

  const seen = ok.body.product.revision;
  products[0]!.variants[0].stockQuantity = 6;
  products[0]!.updatedAt = tick();
  const stale = await call('stock', { id: PRODUCT, body: { revision: seen, variantId: VARIANT, quantity: 20 }, key: key() });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'CONFLICT');
  assert.equal(stale.body.current.variants[0].stockQuantity, 6);
  assert.equal(products[0]!.variants[0].stockQuantity, 6);
  assert.equal(movements.length, 1);

  const untracked = await call('stock', { id: PRODUCT, body: { revision: products[0]!.updatedAt.getTime(), variantId: VARIANT2, quantity: 2 }, key: key() });
  assert.equal(untracked.status, 422);
  assert.equal(untracked.body.code, 'VARIANT_NOT_TRACKED');
  assert.equal((await call('stock', { id: PRODUCT, body: { revision: 1, variantId: VARIANT, quantity: -1 }, key: key() })).status, 400);
});

test('price: one variant through the portal rules, minPrice follows, stock untouched; a moved revision is a conflict', async () => {
  const ok = await call('price', { id: PRODUCT, body: { revision: T0.getTime(), variantId: VARIANT, price: 1800 }, key: key() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.product.variants[0].price, ok.body.product.variants[1].price, ok.body.product.minPrice], [1800, 1600, 1600]);
  assert.equal(products[0]!.variants[0].stockQuantity, 10);

  const stale = await call('price', { id: PRODUCT, body: { revision: T0.getTime(), variantId: VARIANT, price: 1 }, key: key() });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current.variants[0].price, 1800);

  const badCompare = await call('price', { id: PRODUCT, body: { revision: ok.body.product.revision, variantId: VARIANT, price: 2000, compareAtPrice: 10 }, key: key() });
  assert.equal(badCompare.status, 422);
  assert.equal(badCompare.body.errors[0].code, 'INVALID_VARIANTS');
  assert.equal(products[0]!.variants[0].price, 1800);
});

test('writes keep the roles and the stores: support notes but cannot change status, stock or price; a foreign store is 403, a foreign order 404', async () => {
  assert.equal((await call('note', { who: 'helper', id: ORDER, body: { revision: rev(), text: 'ok' }, key: key() })).status, 200);
  assert.equal((await call('status', { who: 'helper', id: ORDER, body: confirm(rev()), key: key() })).status, 403);
  assert.equal((await call('stock', { who: 'helper', id: PRODUCT, body: { revision: 1, variantId: VARIANT, quantity: 1 }, key: key() })).status, 403);
  assert.equal((await call('price', { who: 'helper', id: PRODUCT, body: { revision: 1, variantId: VARIANT, price: 1 }, key: key() })).status, 403);
  assert.equal((await call('status', { store: OTHER_STORE, id: ORDER, body: confirm(rev()), key: key() })).status, 403);
  assert.equal((await call('status', { id: FOREIGN_ORDER, body: confirm(1), key: key() })).status, 404);
});
