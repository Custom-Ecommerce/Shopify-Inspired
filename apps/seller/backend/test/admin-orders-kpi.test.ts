import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { CommissionEntry, Order, Store, Subscription, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { ADMIN_ORDER_FORBIDDEN_KEYS, adminOrderDetailSchema, adminOrderListSchema } from '../../../../packages/contracts/src/admin-orders';
import { adminKpiSchema } from '../../../../packages/contracts/src/admin-overview';
import { orderFilter } from '../src/lib/admin-orders';
import { periodStarts, toKpiPeriod, toSellersByPlan, toStatusCounts } from '../src/lib/admin-kpi';

// Sprint 6 (S6-B5): the signed internal orders list and detail, and the KPI route. Models are stubbed; no database.

const MOD_SECRET = 'm'.repeat(40);
const AUTH_SECRET = 'x'.repeat(40);
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const ORDER_1 = '65a0000000000000000a0001';
const ORDER_2 = '65a0000000000000000a0002';

const OrderModel = Order as any;
const StoreModel = Store as any;
const EntryModel = CommissionEntry as any;
const SubModel = Subscription as any;
const UserModel = User as any;

let listPOST: (r: NextRequest) => Promise<Response>;
let detailPOST: (r: NextRequest) => Promise<Response>;
let kpiPOST: (r: NextRequest) => Promise<Response>;
let restore: () => void = () => {};
let selects: string[];
let filters: any[];
let aggregates: any[][];
let sellerToken = '';

const PRIVATE = { phone: '+923001234567', phoneKey: '3001234567', address: 'House 1, Street 2', customerName: 'Ayesha Khan', customerEmail: 'a@example.com', customerNote: 'call me', notes: [{ text: 'x' }] };

const orders: any[] = [
  { _id: ORDER_1, store: STORE_A, orderId: 'ORD-ABCD2345', status: 'delivered', paymentMethod: 'cod', total: 7250, city: 'Lahore', createdAt: new Date('2026-11-14T08:00:00Z'), updatedAt: new Date('2026-11-15T08:00:00Z'), subtotal: 7000, deliveryCharges: 250, discountAmount: 0, paymentStatus: 'collected', confirmationStatus: 'confirmed', items: [{ productTitle: 'Lawn suit', variantTitle: 'Blue', unitPrice: 3500, quantity: 2 }], statusHistory: [{ from: 'pending', to: 'delivered', at: new Date('2026-11-15T08:00:00Z'), by: 'u1', note: 'call 0300', kind: 'status' }, { kind: 'stock', from: 'pending', to: 'pending', at: new Date() }], ...PRIVATE },
  { _id: ORDER_2, store: STORE_A, orderId: 'ORD-ZZZZ9999', status: 'pending', paymentMethod: 'card', total: 1000, city: null, createdAt: new Date('2026-11-16T08:00:00Z'), updatedAt: new Date('2026-11-16T08:00:00Z'), subtotal: 900, deliveryCharges: 100, items: [], statusHistory: [], paymentStatus: 'unpaid', ...PRIVATE },
];

const SAFE_SELECT_FORBIDDEN = ['phone', 'address', 'customerName', 'customerEmail', 'customerNote', 'notes'];

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  sellerToken = await signSession({ sub: ADMIN, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  listPOST = (await import('../src/app/api/internal/orders/route')).POST;
  detailPOST = (await import('../src/app/api/internal/orders/detail/route')).POST;
  kpiPOST = (await import('../src/app/api/internal/kpi/route')).POST;
});

const chain = (value: () => unknown, record?: (sel: string) => void) => {
  const q: any = { select: (s: string) => (record?.(s), q), sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  selects = [];
  filters = [];
  aggregates = [];
  const saved = {
    connect: (mongoose as any).connect,
    find: OrderModel.find, findOne: OrderModel.findOne, count: OrderModel.countDocuments, agg: OrderModel.aggregate,
    sfind: StoreModel.find, eagg: EntryModel.aggregate, subagg: SubModel.aggregate, ucount: UserModel.countDocuments,
  };
  (mongoose as any).connect = async () => mongoose;
  // The stub returns the FULL documents (with the private fields) unless the query selected only safe ones: it honours select().
  const project = (docs: any[], sel: string) => {
    const wanted = new Set(sel.split(/\s+/).filter(Boolean));
    return docs.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k === '_id' || wanted.has(k))));
  };
  OrderModel.find = (filter: any) => {
    filters.push(filter);
    let sel = '';
    const q: any = { select: (s: string) => ((sel = s), selects.push(s), q), sort: () => q, skip: () => q, limit: () => q, lean: async () => project(orders, sel) };
    return q;
  };
  OrderModel.countDocuments = async (filter: any) => (filters.push(filter), orders.length);
  OrderModel.findOne = (filter: any) => {
    let sel = '';
    const q: any = { select: (s: string) => ((sel = s), selects.push(s), q), lean: async () => { const d = orders.find((o) => o._id === String(filter._id)); return d ? project([d], sel)[0] : null; } };
    return q;
  };
  OrderModel.aggregate = async (p: any[]) => (aggregates.push(p), [{ _id: 'pending', count: 4 }, { _id: 'delivered', count: 9 }, { _id: 'weird', count: 1 }]);
  StoreModel.find = () => chain(() => [{ _id: STORE_A, name: 'Zara Lawn' }]);
  EntryModel.aggregate = async (p: any[]) => (aggregates.push(p), p[0].$match.settledAt === null ? [{ _id: null, total: -1200 }] : p.some((s) => s.$limit) ? [{ _id: STORE_A, sales: 50000 }] : [{ _id: 'card', sales: 20000, effect: -800, orders: 5 }, { _id: 'cod', sales: 30000, effect: 0, orders: 7 }]);
  SubModel.aggregate = async (p: any[]) => (aggregates.push(p), [{ _id: { planKey: 'growth', status: 'active' }, count: 3 }]);
  UserModel.countDocuments = async () => 10;
  restore = () => {
    (mongoose as any).connect = saved.connect;
    Object.assign(OrderModel, { find: saved.find, findOne: saved.findOne, countDocuments: saved.count, aggregate: saved.agg });
    StoreModel.find = saved.sfind; EntryModel.aggregate = saved.eagg; SubModel.aggregate = saved.subagg; UserModel.countDocuments = saved.ucount;
    delete process.env.MODERATION_API_SECRET;
  };
});

afterEach(() => restore());

const signed = (path: string, body: unknown, secret = MOD_SECRET): NextRequest => {
  const raw = JSON.stringify(body);
  return new NextRequest('http://seller.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...internalRequestHeaders(secret, { method: 'POST', path, adminId: ADMIN, body: raw }) }, body: raw });
};

/** Walks a DTO and fails on any forbidden key, at any depth. */
function assertNoForbiddenKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoForbiddenKeys(v, path + '[' + i + ']'));
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      assert.equal((ADMIN_ORDER_FORBIDDEN_KEYS as readonly string[]).some((bad) => bad.toLowerCase() === key.toLowerCase()), false, 'forbidden key ' + path + '.' + key);
      assertNoForbiddenKeys(v, path + '.' + key);
    }
  } else if (typeof value === 'string') {
    for (const secret of [PRIVATE.phone, PRIVATE.address, PRIVATE.customerName, PRIVATE.customerEmail, PRIVATE.customerNote]) assert.equal(value.includes(secret), false, 'private value at ' + path);
  }
}

test('an unsigned, wrongly signed or seller-session call is refused (401) on all three routes, and nothing is read', async () => {
  const bodies: Array<[(r: NextRequest) => Promise<Response>, string, unknown]> = [
    [listPOST, '/api/internal/orders', { page: 1, limit: 20 }],
    [detailPOST, '/api/internal/orders/detail', { orderId: ORDER_1 }],
    [kpiPOST, '/api/internal/kpi', {}],
  ];
  for (const [handler, path, body] of bodies) {
    const plain = new NextRequest('http://seller.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sellerToken }, body: JSON.stringify(body) });
    assert.equal((await handler(plain)).status, 401, path + ' seller session');
    assert.equal((await handler(signed(path, body, 'w'.repeat(40)))).status, 401, path + ' wrong secret');
  }
  assert.equal(selects.length + aggregates.length, 0);
});

test('the list walks every DTO: only safe keys, no phone, address, email or name, and the query SELECTS only safe fields', async () => {
  const res = await listPOST(signed('/api/internal/orders', { page: 1, limit: 20 }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(adminOrderListSchema.safeParse(body).success, true);
  assertNoForbiddenKeys(body);
  assert.deepEqual(body.docs[0], { id: ORDER_1, orderNumber: 'ORD-ABCD2345', storeId: STORE_A, storeName: 'Zara Lawn', status: 'delivered', paymentMethod: 'cod', total: 7250, city: 'Lahore', itemCount: 2, createdAt: '2026-11-14T08:00:00.000Z', updatedAt: '2026-11-15T08:00:00.000Z' });
  for (const sel of selects) for (const bad of SAFE_SELECT_FORBIDDEN) assert.equal(sel.split(/\s+/).includes(bad), false, 'selects ' + bad);
});

test('the list filters by store, status, date range (to is inclusive) and an anchored, escaped order-number prefix; the page is capped at 50', async () => {
  const res = await listPOST(signed('/api/internal/orders', { store: STORE_A, status: 'pending', from: '2026-11-01', to: '2026-11-30', q: 'ORD.*', page: 2, limit: 50 }));
  assert.equal(res.status, 200);
  const f = filters[0];
  assert.deepEqual([f.store, f.status], [STORE_A, 'pending']);
  assert.equal(f.createdAt.$gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(f.createdAt.$lt.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(f.orderId.$regex, '^ORD\\.\\*');
  assert.equal((await listPOST(signed('/api/internal/orders', { page: 1, limit: 51 }))).status, 422);
  assert.equal((await listPOST(signed('/api/internal/orders', { page: 1, limit: 20, phone: '0300' }))).status, 422, 'no filter by a private field');
  assert.deepEqual(orderFilter({}), {});
});

test('the detail has items, totals, status history, payment and confirmation state; whole rupees; no private key anywhere', async () => {
  const res = await detailPOST(signed('/api/internal/orders/detail', { orderId: ORDER_1 }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(adminOrderDetailSchema.safeParse(body.order).success, true);
  assertNoForbiddenKeys(body);
  assert.deepEqual(body.order.items, [{ name: 'Lawn suit (Blue)', quantity: 2, unitPrice: 3500, lineTotal: 7000 }]);
  assert.deepEqual(body.order.totals, { subtotal: 7000, discount: 0, delivery: 250, total: 7250 });
  assert.equal(body.order.statusHistory.length, 1, 'only status changes; no note, no actor');
  assert.deepEqual([body.order.paymentStatus, body.order.confirmationStatus], ['collected', 'confirmed']);
  for (const sel of selects) for (const bad of SAFE_SELECT_FORBIDDEN) assert.equal(sel.split(/\s+/).includes(bad), false);
  assert.equal((await detailPOST(signed('/api/internal/orders/detail', { orderId: '65a0000000000000000affff' }))).status, 404);
  assert.equal((await detailPOST(signed('/api/internal/orders/detail', { orderId: 'x' }))).status, 422);
});

test('the detail of a taxed order carries its tax line and the rows add up to the total (exclusive); an included tax is named, not added again', async () => {
  const base = orders.find((o) => o._id === ORDER_1) as unknown as Record<string, unknown>;
  const saved = { ...base };
  try {
    Object.assign(base, { subtotal: 7000, discountAmount: 500, deliveryCharges: 250, taxAmount: 813, taxMode: 'exclusive', taxRatePercent: 12.5, taxLabel: 'GST', total: 7563 });
    const read = async () => (await (await detailPOST(signed('/api/internal/orders/detail', { orderId: ORDER_1 }))).json()).order;
    const exclusive = await read();
    assert.equal(adminOrderDetailSchema.safeParse(exclusive).success, true);
    assert.deepEqual(exclusive.totals, { subtotal: 7000, discount: 500, delivery: 250, total: 7563, tax: 813, taxLabel: 'GST', taxIncluded: false });
    assert.equal(exclusive.totals.subtotal - exclusive.totals.discount + exclusive.totals.tax + exclusive.totals.delivery, exclusive.totals.total);
    Object.assign(base, { taxMode: 'inclusive', taxAmount: 722, total: 6750 });
    assert.deepEqual((await read()).totals, { subtotal: 7000, discount: 500, delivery: 250, total: 6750, tax: 722, taxLabel: 'GST (included)', taxIncluded: true });
  } finally {
    for (const key of Object.keys(base)) delete base[key];
    Object.assign(base, saved);
  }
});

test('the KPI route answers whole rupees from the NEW ledger with aggregations; COD orders at rate 0 still count; no old ledger is read', async () => {
  const res = await kpiPOST(signed('/api/internal/kpi', {}));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(adminKpiSchema.safeParse(body).success, true);
  assert.deepEqual(body.periods.today, { gatewaySales: 20000, commission: 800, gatewayOrders: 5, codOrderValue: 30000, codOrders: 7 });
  assert.equal(body.unsettledBalance, -1200);
  assert.deepEqual(body.topStores, [{ storeId: STORE_A, storeName: 'Zara Lawn', sales: 50000 }]);
  assert.deepEqual(body.sellersByPlan, [{ planKey: 'free', status: 'none', count: 7 }, { planKey: 'growth', status: 'active', count: 3 }]);
  assert.equal(body.ordersByStatus.pending, 4);
  const numbers: number[] = [];
  (function walk(v: unknown) { if (typeof v === 'number') numbers.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(body);
  assert.equal(numbers.every(Number.isInteger), true, 'whole rupees: no cents anywhere');
  assert.equal(aggregates.every((p) => p.some((s) => s.$group)), true, 'every read is a Mongo $group');
});

test('pure helpers: Karachi day starts, period grouping, status counts, sellers by plan', () => {
  const s = periodStarts(new Date('2026-11-20T21:00:00Z'));
  assert.equal(s.today.toISOString(), '2026-11-20T19:00:00.000Z', 'it is already 21 Nov 02:00 in Karachi');
  assert.equal(s.last7.getTime(), s.today.getTime() - 6 * 86_400_000);
  assert.deepEqual(toKpiPeriod([]), { gatewaySales: 0, commission: 0, gatewayOrders: 0, codOrderValue: 0, codOrders: 0 });
  assert.equal(toKpiPeriod([{ _id: 'cod', sales: 100, effect: 0, orders: -2 }]).codOrders, 0);
  assert.equal(toStatusCounts([{ _id: 'x', count: 5 }]).pending, 0);
  assert.deepEqual(toSellersByPlan([], 2), [{ planKey: 'free', status: 'none', count: 2 }]);
});
