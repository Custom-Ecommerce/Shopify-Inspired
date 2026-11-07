import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { signSession, Order, Store } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { orderSearchFilter, pakistanDayStart, toDashboardOrderDetail, toDashboardOrderListItem } from '@/lib/orders';

// EP-02 OB-1b: the seller order list and detail. Models are stubbed; no database is used.

const { dashboardOrderDetailSchema, dashboardOrderListResponseSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';

const OrderModel = Order as any;
const StoreModel = Store as any;

const stores = [
  { _id: STORE_A, owner: USER_A, createdAt: new Date('2026-01-01T00:00:00Z') },
  { _id: STORE_B, owner: USER_B, createdAt: new Date('2026-01-02T00:00:00Z') },
];

let orders: Array<Record<string, any>> = [];
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let listGET: (request: NextRequest) => Promise<Response>;
let detailGET: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  listGET = (await import('../src/app/api/orders/route')).GET;
  detailGET = (await import('../src/app/api/orders/[id]/route')).GET;
});

// ---------------------------------------------------------------------------------------------------------------------
// A small in-memory evaluator for the filters the routes build. An invalid regex throws here as it would in MongoDB,
// so a search that forgot to escape its text fails the test.

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return new Date(a as any).getTime() === new Date(b as any).getTime();
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : typeof a === 'string' && b instanceof Date ? Date.parse(a) : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

function fieldMatches(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date || mongoose.isValidObjectId(condition)) {
    return condition === null ? value === null || value === undefined : same(value, condition);
  }
  const ops = condition as Record<string, any>;
  return Object.entries(ops).every(([op, arg]) => {
    switch (op) {
      case '$eq': return same(value, arg);
      case '$ne': return !same(value, arg);
      case '$in': return (arg as unknown[]).some((v) => same(value, v));
      case '$nin': return !(arg as unknown[]).some((v) => same(value, v));
      case '$gte': return value !== undefined && compare(value, arg) >= 0;
      case '$gt': return value !== undefined && compare(value, arg) > 0;
      case '$lte': return value !== undefined && compare(value, arg) <= 0;
      case '$lt': return value !== undefined && compare(value, arg) < 0;
      case '$regex': return typeof value === 'string' && new RegExp(arg, ops.$options ?? '').test(value);
      case '$options': return true;
      case '$exists': return (value !== undefined) === Boolean(arg);
      default: throw new Error('unsupported operator in test evaluator: ' + op);
    }
  });
}

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return (condition as any[]).every((sub) => matches(row, sub));
    if (key === '$or') return (condition as any[]).some((sub) => matches(row, sub));
    return fieldMatches(row[key], condition);
  });
}

function sortRows(rows: Array<Record<string, any>>, spec: Record<string, 1 | -1>) {
  return [...rows].sort((a, b) => {
    for (const [key, dir] of Object.entries(spec)) {
      const c = compare(a[key] instanceof Date ? a[key] : String(a[key]), b[key] instanceof Date ? b[key] : String(b[key]));
      const order = key === '_id' ? (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0) : c;
      if (order !== 0) return order * dir;
    }
    return 0;
  });
}

function findQuery(rows: Array<Record<string, any>>, single = false) {
  let current = rows;
  let skip = 0;
  let limit = Infinity;
  const q: any = {
    sort: (spec: Record<string, 1 | -1>) => {
      current = sortRows(current, spec);
      return q;
    },
    skip: (n: number) => {
      skip = n;
      return q;
    },
    limit: (n: number) => {
      limit = n;
      return q;
    },
    select: () => q,
    lean: async () => {
      // A shallow copy keeps ObjectId and Date values as a real .lean() returns them.
      const page = current.slice(skip, skip + limit).map((row) => ({ ...row }));
      return single ? page[0] ?? null : page;
    },
  };
  return q;
}

let restoreStubs: (() => void) | null = null;
const calls = { aggregate: [] as unknown[] };

beforeEach(() => {
  const originals = {
    connect: (mongoose as any).connect,
    find: OrderModel.find,
    findOne: OrderModel.findOne,
    countDocuments: OrderModel.countDocuments,
    aggregate: OrderModel.aggregate,
    storeExists: StoreModel.exists,
    storeFindOne: StoreModel.findOne,
  };
  calls.aggregate = [];
  (mongoose as any).connect = async () => mongoose;
  OrderModel.find = (filter: any) => findQuery(orders.filter((row) => matches(row, filter)));
  OrderModel.findOne = (filter: any) => findQuery(orders.filter((row) => matches(row, filter)), true);
  OrderModel.countDocuments = async (filter: any) => orders.filter((row) => matches(row, filter)).length;
  OrderModel.aggregate = async (pipeline: any[]) => {
    calls.aggregate.push(pipeline);
    const match = pipeline.find((stage) => '$match' in stage).$match;
    // aggregate() is not cast by Mongoose: the store must already be an ObjectId.
    assert.ok(match.store instanceof mongoose.Types.ObjectId, 'aggregate $match.store is an ObjectId');
    const groups = new Map<string, number>();
    for (const row of orders.filter((r) => matches(r, match))) groups.set(row.status, (groups.get(row.status) ?? 0) + 1);
    return [...groups].map(([status, count]) => ({ _id: status, count }));
  };
  StoreModel.exists = async (filter: any) => (stores.some((s) => matches(s, filter)) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => findQuery(stores.filter((s) => matches(s, filter)), true);
  restoreStubs = () => {
    (mongoose as any).connect = originals.connect;
    OrderModel.find = originals.find;
    OrderModel.findOne = originals.findOne;
    OrderModel.countDocuments = originals.countDocuments;
    OrderModel.aggregate = originals.aggregate;
    StoreModel.exists = originals.storeExists;
    StoreModel.findOne = originals.storeFindOne;
  };
  seed();
});

afterEach(() => {
  restoreStubs?.();
  restoreStubs = null;
});

// ---------------------------------------------------------------------------------------------------------------------
// Data. Times are UTC; Pakistan time is UTC+05:00.

const oid = (n: number): string => '65a0000000000000000a' + String(n).padStart(4, '0');
const USER_A_ID = new mongoose.Types.ObjectId(USER_A);

function order(n: number, fields: Record<string, any>): Record<string, any> {
  return {
    _id: oid(n),
    store: STORE_A,
    orderId: 'ORD-' + String(n).padStart(8, 'A'),
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    customerName: 'Customer ' + n,
    phone: '+92300000' + String(n).padStart(4, '0'),
    city: 'Karachi',
    address: 'House ' + n + ', Street 4',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', sku: null, unitPrice: 1000, quantity: 1 }],
    subtotal: 1000,
    deliveryCharges: 0,
    total: 1000,
    idempotencyKey: 'idem-key-' + n,
    requestFingerprint: 'fp-' + n,
    statusHistory: [],
    notes: [],
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...fields,
  };
}

function seed() {
  orders = [
    order(1, { orderId: 'ORD-ABCD2345', customerName: 'Sara Khan', phone: '+923001234567', status: 'pending', createdAt: new Date('2026-11-01T10:00:00Z') }),
    order(2, { orderId: 'ORD-ABCE7777', customerName: 'Bilal Ahmed', phone: '+923211112222', status: 'confirmed', createdAt: new Date('2026-11-02T10:00:00Z') }),
    order(3, { orderId: 'ORD-ZZZZ9999', customerName: 'Ali (Shop) Traders', phone: '03111234567', status: 'dispatched', courier: 'TCS', trackingNumber: 'TCS123', createdAt: new Date('2026-11-03T10:00:00Z') }),
    // 23:59 Pakistan time on 6 Nov, and 00:01 Pakistan time on 7 Nov.
    order(4, { orderId: 'ORD-LATE2359', customerName: 'Late Night', status: 'delivered', createdAt: new Date('2026-11-06T18:59:00Z') }),
    order(5, { orderId: 'ORD-EARLY001', customerName: 'Early Bird', status: 'cancelled', createdAt: new Date('2026-11-06T19:01:00Z') }),
    order(6, { orderId: 'ORD-SARA0006', customerName: 'sara ali', status: 'processing', createdAt: new Date('2026-11-05T10:00:00Z') }),
    // Another store's order with a name and phone that would match searches.
    order(7, { store: STORE_B, orderId: 'ORD-OTHER777', customerName: 'Sara Other', phone: '+923001234500', status: 'pending', createdAt: new Date('2026-11-04T10:00:00Z') }),
  ];
}

/** An order written before EP-02: none of the EP-02 fields, no payment method. */
function oldOrder(): Record<string, any> {
  return {
    _id: oid(9),
    store: STORE_A,
    orderId: 'ORD-OLDD2345',
    status: 'confirmed',
    customerName: 'Old Customer',
    phone: '03001112222',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Cap', variantTitle: 'Default', unitPrice: 450, quantity: 3 }],
    subtotal: 1350,
    deliveryCharges: 150,
    total: 1500,
    idempotencyKey: 'idem-old-1234',
    requestFingerprint: 'fp-old',
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
  };
}

function get(url: string, token: string | null = tokenA, headers: Record<string, string> = {}): NextRequest {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  return new NextRequest('http://seller.test' + url, { method: 'GET', headers: h });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function listJson(url: string, token: string | null = tokenA, headers: Record<string, string> = {}) {
  const res = await listGET(get(url, token, headers));
  return { status: res.status, body: (await res.json()) as any, text: '' };
}

const orderIds = (body: any): string[] => body.docs.map((doc: any) => doc.orderId);

// ---------------------------------------------------------------------------------------------------------------------
// Access

test('orders: no login is 401 on the list and the detail', async () => {
  assert.equal((await listGET(get('/api/orders', null))).status, 401);
  assert.equal((await detailGET(get('/api/orders/' + oid(1), null), params(oid(1)))).status, 401);
});

test('orders: an admin session is 403 on the list and the detail (D-067)', async () => {
  assert.equal((await listGET(get('/api/orders', tokenAdmin, { 'x-store-id': STORE_A }))).status, 403);
  assert.equal((await listGET(get('/api/orders?where=' + encodeURIComponent('{}'), tokenAdmin, { 'x-store-id': STORE_A }))).status, 403);
  assert.equal((await detailGET(get('/api/orders/' + oid(1), tokenAdmin, { 'x-store-id': STORE_A }), params(oid(1)))).status, 403);
});

test("orders: seller B naming seller A's store is 403 on the list and the detail", async () => {
  assert.equal((await listGET(get('/api/orders', tokenB, { 'x-store-id': STORE_A }))).status, 403);
  assert.equal((await detailGET(get('/api/orders/' + oid(1), tokenB, { 'x-store-id': STORE_A }), params(oid(1)))).status, 403);
});

test("orders: another store's order id is 404 and its content is not returned", async () => {
  const res = await detailGET(get('/api/orders/' + oid(7)), params(oid(7)));
  assert.equal(res.status, 404);
  assert.equal((await res.text()).includes('ORD-OTHER777'), false);
  assert.equal((await detailGET(get('/api/orders/not-an-id'), params('not-an-id'))).status, 404);
});

test('orders: the list is store scoped, newest first, with counts for the store only', async () => {
  const { status, body } = await listJson('/api/orders');
  assert.equal(status, 200);
  assert.equal(dashboardOrderListResponseSchema.safeParse(body).success, true);
  assert.deepEqual(orderIds(body), ['ORD-EARLY001', 'ORD-LATE2359', 'ORD-SARA0006', 'ORD-ZZZZ9999', 'ORD-ABCE7777', 'ORD-ABCD2345']);
  assert.equal(body.totalDocs, 6);
  assert.deepEqual(body.counts, { all: 6, pending: 1, confirmed: 1, processing: 1, dispatched: 1, delivered: 1, cancelled: 1, returned: 0 });

  const asB = await listJson('/api/orders', tokenB);
  assert.deepEqual(orderIds(asB.body), ['ORD-OTHER777']);
  assert.equal(asB.body.counts.all, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Filters

test('orders: the status filter narrows the list but not the counts', async () => {
  const { body } = await listJson('/api/orders?status=dispatched');
  assert.deepEqual(orderIds(body), ['ORD-ZZZZ9999']);
  assert.equal(body.totalDocs, 1);
  assert.equal(body.counts.all, 6);
  assert.equal(body.counts.pending, 1);
  const returned = await listJson('/api/orders?status=returned');
  assert.equal(returned.status, 200);
  assert.deepEqual(returned.body.docs, []);
});

test('orders: date range edges follow Pakistan time (23:59 and 00:01)', async () => {
  assert.equal(pakistanDayStart('2026-11-07').toISOString(), '2026-11-06T19:00:00.000Z');
  const seventh = await listJson('/api/orders?from=2026-11-07&to=2026-11-07');
  assert.deepEqual(orderIds(seventh.body), ['ORD-EARLY001']);
  const sixth = await listJson('/api/orders?from=2026-11-06&to=2026-11-06');
  assert.deepEqual(orderIds(sixth.body), ['ORD-LATE2359']);
  const untilSixth = await listJson('/api/orders?to=2026-11-06');
  assert.equal(orderIds(untilSixth.body).includes('ORD-EARLY001'), false);
  assert.equal(orderIds(untilSixth.body).includes('ORD-LATE2359'), true);
  const fromSeventh = await listJson('/api/orders?from=2026-11-07');
  assert.deepEqual(orderIds(fromSeventh.body), ['ORD-EARLY001']);
});

test('orders: search by order number prefix, in any case', async () => {
  assert.deepEqual(orderIds((await listJson('/api/orders?q=ord-abc')).body), ['ORD-ABCE7777', 'ORD-ABCD2345']);
  assert.deepEqual(orderIds((await listJson('/api/orders?q=ORD-ABCD2345')).body), ['ORD-ABCD2345']);
  // A prefix, not a contains match.
  assert.deepEqual(orderIds((await listJson('/api/orders?q=ORD-2345')).body), []);
});

test('orders: search by phone in the 03xx and +92 forms', async () => {
  assert.deepEqual(orderIds((await listJson('/api/orders?q=0300123')).body), ['ORD-ABCD2345']);
  assert.deepEqual(orderIds((await listJson('/api/orders?q=' + encodeURIComponent('+92300123'))).body), ['ORD-ABCD2345']);
  assert.deepEqual(orderIds((await listJson('/api/orders?q=03001234567')).body), ['ORD-ABCD2345']);
  // An older order stored in the local form is found by its +92 form too.
  assert.deepEqual(orderIds((await listJson('/api/orders?q=' + encodeURIComponent('+92311'))).body), ['ORD-ZZZZ9999']);
  // Seller A never sees store B's +923001234500 even though the prefix matches it.
  assert.equal(orderIds((await listJson('/api/orders?q=0300123450')).body).length, 0);
});

test('orders: search by customer name is a case-insensitive contains match', async () => {
  assert.deepEqual(orderIds((await listJson('/api/orders?q=SARA')).body), ['ORD-SARA0006', 'ORD-ABCD2345']);
  assert.deepEqual(orderIds((await listJson('/api/orders?q=khan')).body), ['ORD-ABCD2345']);
});

test('orders: regex characters in q are literal: no crash, no match-everything', async () => {
  for (const q of ['.', '.*', '(', '[', '\\', '.*|', 'a+', '^', '$']) {
    const { status, body } = await listJson('/api/orders?q=' + encodeURIComponent(q));
    assert.equal(status, 200, q);
    assert.ok(body.totalDocs < 6, q + ' must not match everything');
  }
  // "(" is matched literally: only the name that contains it.
  assert.deepEqual(orderIds((await listJson('/api/orders?q=' + encodeURIComponent('(Shop)'))).body), ['ORD-ZZZZ9999']);
  assert.deepEqual(orderIds((await listJson('/api/orders?q=' + encodeURIComponent('.*'))).body), []);
  assert.deepEqual(orderSearchFilter('a.b'), { customerName: { $regex: 'a\\.b', $options: 'i' } });
});

test('orders: q is trimmed and cut to 40 characters', async () => {
  const { status } = await listJson('/api/orders?q=' + encodeURIComponent('  ' + 'x'.repeat(80) + '  '));
  assert.equal(status, 200);
  const filter = orderSearchFilter('x'.repeat(40));
  assert.equal((filter as any).customerName.$regex.length, 40);
});

test('orders: counts ignore the status filter but respect search and dates', async () => {
  const searched = await listJson('/api/orders?status=pending&q=sara');
  assert.deepEqual(orderIds(searched.body), ['ORD-ABCD2345']);
  assert.deepEqual(searched.body.counts, { all: 2, pending: 1, confirmed: 0, processing: 1, dispatched: 0, delivered: 0, cancelled: 0, returned: 0 });

  const dated = await listJson('/api/orders?status=delivered&from=2026-11-06&to=2026-11-07');
  assert.deepEqual(orderIds(dated.body), ['ORD-LATE2359']);
  assert.deepEqual(dated.body.counts, { all: 2, pending: 0, confirmed: 0, processing: 0, dispatched: 0, delivered: 1, cancelled: 1, returned: 0 });

  const match = (calls.aggregate.at(-1) as any[])[0].$match;
  assert.equal('status' in match, false);
});

test('orders: pagination and the limit cap', async () => {
  const first = await listJson('/api/orders?limit=2&page=1');
  assert.deepEqual(orderIds(first.body), ['ORD-EARLY001', 'ORD-LATE2359']);
  assert.equal(first.body.totalPages, 3);
  assert.equal(first.body.hasNextPage, true);
  assert.equal(first.body.hasPrevPage, false);
  const last = await listJson('/api/orders?limit=2&page=3');
  assert.deepEqual(orderIds(last.body), ['ORD-ABCE7777', 'ORD-ABCD2345']);
  assert.equal(last.body.hasNextPage, false);
  const beyond = await listJson('/api/orders?limit=2&page=9');
  assert.deepEqual(beyond.body.docs, []);
  const capped = await listJson('/api/orders?limit=500');
  assert.equal(capped.status, 200);
  assert.equal(capped.body.limit, 100);
  const defaults = await listJson('/api/orders');
  assert.equal(defaults.body.limit, 20);
  assert.equal(defaults.body.page, 1);
});

test('orders: bad parameters answer 400 with a clear code', async () => {
  const cases: Array<[string, string]> = [
    ['status=shipped', 'ORDER_STATUS_INVALID'],
    ['from=2026-13-01', 'ORDER_DATE_INVALID'],
    ['to=2026-02-30', 'ORDER_DATE_INVALID'],
    ['from=07-11-2026', 'ORDER_DATE_INVALID'],
    ['from=2026-11-08&to=2026-11-07', 'ORDER_DATE_RANGE_INVALID'],
    ['page=0', 'ORDER_PAGE_INVALID'],
    ['page=abc', 'ORDER_PAGE_INVALID'],
    ['limit=0', 'ORDER_LIMIT_INVALID'],
    ['limit=abc', 'ORDER_LIMIT_INVALID'],
    ['limit=2.5', 'ORDER_LIMIT_INVALID'],
  ];
  for (const [query, code] of cases) {
    const { status, body } = await listJson('/api/orders?' + query);
    assert.equal(status, 400, query);
    assert.equal(body.errors[0].code, code, query);
  }
  // An empty parameter means "not set", as a submitted empty form field sends it.
  assert.equal((await listJson('/api/orders?status=&q=&from=&to=')).status, 200);
});

test('orders: the legacy ?where and ?sort behaviour still works, without counts', async () => {
  const where = encodeURIComponent(JSON.stringify({ and: [{ store: { equals: STORE_A } }, { status: { equals: 'confirmed' } }] }));
  const { status, body } = await listJson('/api/orders?where=' + where + '&limit=1000&depth=0');
  assert.equal(status, 200);
  assert.deepEqual(orderIds(body), ['ORD-ABCE7777']);
  assert.equal(body.limit, 1000);
  assert.equal('counts' in body, false);
  assert.equal(body.docs[0].id, oid(2));
  assert.equal('idempotencyKey' in body.docs[0], false);
  assert.equal('requestFingerprint' in body.docs[0], false);

  const sorted = await listJson('/api/orders?where=' + encodeURIComponent('{}') + '&sort=total&limit=1');
  assert.equal(sorted.body.totalDocs, 6);

  // The new parameters win when both are sent.
  const both = await listJson('/api/orders?where=' + where + '&status=pending');
  assert.deepEqual(orderIds(both.body), ['ORD-ABCD2345']);
  assert.ok('counts' in both.body);
});

// ---------------------------------------------------------------------------------------------------------------------
// Shapes

test('orders: a list row has exactly the dashboard fields', async () => {
  const { body } = await listJson('/api/orders?status=dispatched');
  assert.deepEqual(Object.keys(body.docs[0]).sort(), [
    'city', 'courier', 'createdAt', 'customerName', 'id', 'itemCount', 'orderId', 'paymentMethod', 'paymentStatus',
    'phone', 'status', 'total', 'trackingNumber',
  ]);
  assert.equal(body.docs[0].courier, 'TCS');
  assert.equal(body.docs[0].trackingNumber, 'TCS123');
  assert.equal(body.docs[0].itemCount, 1);
});

test('orders: an old order without EP-02 fields maps to the defaults, in the list and the detail', async () => {
  orders = [oldOrder()];
  const { body } = await listJson('/api/orders');
  assert.equal(dashboardOrderListResponseSchema.safeParse(body).success, true);
  const row = body.docs[0];
  assert.equal(row.paymentStatus, 'unpaid');
  assert.equal(row.paymentMethod, null);
  assert.equal(row.courier, null);
  assert.equal(row.trackingNumber, null);
  assert.equal(row.city, null);
  assert.equal(row.itemCount, 3);

  const res = await detailGET(get('/api/orders/' + oid(9)), params(oid(9)));
  assert.equal(res.status, 200);
  const detail = (await res.json()) as any;
  assert.equal(dashboardOrderDetailSchema.safeParse(detail).success, true);
  assert.deepEqual(detail.statusHistory, []);
  assert.deepEqual(detail.notes, []);
  assert.equal(detail.paymentStatus, 'unpaid');
  assert.equal(detail.collectedAt, null);
  assert.equal(detail.collectedAmount, null);
  assert.equal(detail.trackingUrl, null);
  assert.equal(detail.cancelledAt, null);
  assert.equal(detail.cancelReason, null);
  assert.deepEqual(detail.items, [{ productTitle: 'Cap', variantTitle: 'Default', sku: null, unitPrice: 450, quantity: 3, lineTotal: 1350 }]);
});

test('orders: the detail shape, with history and notes newest first', async () => {
  orders.push(
    order(8, {
      status: 'dispatched',
      paymentStatus: 'collected',
      collectedAt: new Date('2026-11-05T12:00:00Z'),
      collectedAmount: 2600,
      courier: 'Leopards',
      trackingNumber: 'LP-1',
      trackingUrl: 'https://example.test/LP-1',
      items: [
        { productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Red / M', sku: 'SH-RM', unitPrice: 1200, quantity: 2 },
        { productId: 'p2', variantId: 'v2', productTitle: 'Cap', variantTitle: 'Default', sku: null, unitPrice: 200, quantity: 1 },
      ],
      subtotal: 2600,
      deliveryCharges: 0,
      total: 2600,
      statusHistory: [
        { from: 'pending', to: 'confirmed', by: USER_A_ID, at: new Date('2026-11-02T10:00:00Z'), note: null },
        { from: 'confirmed', to: 'processing', by: USER_A_ID, at: new Date('2026-11-03T10:00:00Z') },
        { from: 'processing', to: 'dispatched', by: USER_A_ID, at: new Date('2026-11-04T10:00:00Z'), note: 'Sent with Leopards' },
      ],
      notes: [
        { _id: new mongoose.Types.ObjectId('65a0000000000000000b0001'), text: 'First note', by: USER_A_ID, at: new Date('2026-11-02T11:00:00Z') },
        { _id: new mongoose.Types.ObjectId('65a0000000000000000b0002'), text: 'Second note', by: USER_A_ID, at: new Date('2026-11-04T11:00:00Z') },
      ],
    }),
  );
  const res = await detailGET(get('/api/orders/' + oid(8)), params(oid(8)));
  assert.equal(res.status, 200);
  const detail = (await res.json()) as any;
  assert.equal(dashboardOrderDetailSchema.safeParse(detail).success, true);
  assert.deepEqual(Object.keys(detail).sort(), [
    'address', 'allowedNext', 'cancelReason', 'cancelledAt', 'city', 'collectedAmount', 'collectedAt', 'courier', 'createdAt',
    'customerName', 'deliveryCharges', 'id', 'items', 'notes', 'orderId', 'paymentMethod', 'paymentStatus', 'phone',
    'status', 'statusHistory', 'subtotal', 'total', 'trackingNumber', 'trackingUrl', 'updatedAt',
  ]);
  assert.deepEqual(detail.allowedNext, ['delivered']);
  assert.deepEqual(detail.items.map((item: any) => item.lineTotal), [2400, 200]);
  assert.equal(detail.items[0].sku, 'SH-RM');
  assert.deepEqual(detail.statusHistory.map((entry: any) => entry.to), ['dispatched', 'processing', 'confirmed']);
  assert.equal(detail.statusHistory[0].note, 'Sent with Leopards');
  assert.equal(detail.statusHistory[1].note, null);
  assert.equal(detail.statusHistory[0].by, USER_A);
  assert.deepEqual(detail.notes.map((note: any) => note.text), ['Second note', 'First note']);
  assert.equal(detail.notes[0].id, '65a0000000000000000b0002');
  assert.equal(detail.paymentStatus, 'collected');
  assert.equal(detail.collectedAmount, 2600);
  assert.equal(detail.collectedAt, '2026-11-05T12:00:00.000Z');
  assert.equal(detail.trackingUrl, 'https://example.test/LP-1');
});

test('orders: idempotencyKey and requestFingerprint never appear in the list or the detail', async () => {
  const list = await listGET(get('/api/orders'));
  const listText = await list.text();
  const detail = await detailGET(get('/api/orders/' + oid(1)), params(oid(1)));
  const detailText = await detail.text();
  for (const body of [listText, detailText]) {
    assert.equal(body.includes('idempotencyKey'), false);
    assert.equal(body.includes('requestFingerprint'), false);
    assert.equal(body.includes('idem-key-'), false);
    assert.equal(body.includes('fp-1'), false);
  }
});

test('orders mapper: a hydrated document and a lean row map the same way', () => {
  const stored = oldOrder();
  const hydrated = OrderModel.hydrate(stored);
  assert.deepEqual(toDashboardOrderListItem(hydrated), toDashboardOrderListItem(stored));
  const fromHydrated = toDashboardOrderDetail(hydrated);
  assert.equal(fromHydrated.paymentStatus, 'unpaid');
  assert.deepEqual(fromHydrated.statusHistory, []);
  assert.equal('idempotencyKey' in fromHydrated, false);
});
