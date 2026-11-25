import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { DailyStat, Order, Product, ProductDailyStat } from '@/lib/services';
import { buildAnalytics, funnelOf, percent, periodStart, PERIOD_DAYS } from '../src/lib/analytics';
import { countsAsOrder, countsAsRevenue } from '../src/lib/analytics-rules';
import { aggregateResult, matchDoc, runPipeline } from './helpers/aggregate';

// Sprint 8 (S8-B7, D-118): the analytics by aggregation. The OLD in-memory version is kept HERE, as the reference: on the same orders both must give the same
// numbers. The aggregations run in test/helpers/aggregate.ts; no database.

const { analyticsSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

const STORE = '65a000000000000000000011';
const OTHER = '65a000000000000000000012';
const NOW = new Date('2026-11-25T15:30:00.000Z');
const DAY = 86_400_000;
const P1 = '65a0000000000000000000a1';
const P2 = '65a0000000000000000000a2';
const P3 = '65a0000000000000000000a3';

type Row = Record<string, any>;

// ---------------------------------------------------------------------------------------------------------------------
// The reference: the computation of GET /api/analytics before S8-B7, word for word, over rows of one store.

const REVENUE_EXCLUDED = ['cancelled', 'returned'];
const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

function oldAnalytics(rows: Row[], period: '7d' | '30d' | '90d', now: Date) {
  const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const inPeriod = rows.filter((row) => new Date(row.createdAt) >= since);
  const counted = inPeriod.filter((row) => row.status !== 'cancelled');
  const revenueRows = inPeriod.filter((row) => !REVENUE_EXCLUDED.includes(row.status));
  const ordersByStatus: Record<string, number> = {};
  for (const row of inPeriod) ordersByStatus[row.status] = (ordersByStatus[row.status] ?? 0) + 1;
  const revenueTotal = revenueRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const avgOrderValue = revenueRows.length ? Math.round(revenueTotal / revenueRows.length) : 0;
  const dailyMap = new Map<string, number>();
  for (let i = 0; i < days; i += 1) dailyMap.set(dayOf(new Date(since.getTime() + i * 86400000)), 0);
  for (const row of revenueRows) {
    const key = dayOf(new Date(row.createdAt));
    if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + Number(row.total ?? 0));
  }
  const daily = [...dailyMap.entries()].map(([date, amount]) => ({ date, amount }));
  const cityCounts = new Map<string, number>();
  for (const row of counted) {
    const city = (row.city ?? '').trim();
    if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
  }
  const topCities = [...cityCounts.entries()]
    .map(([city, orders]) => ({ city, orders }))
    .sort((a, b) => b.orders - a.orders || a.city.localeCompare(b.city))
    .slice(0, 5);
  const products = new Map<string, { id: string; title: string; revenue: number; orders: number }>();
  for (const row of revenueRows) {
    const seen = new Set<string>();
    for (const item of row.items ?? []) {
      const entry = products.get(item.productId) ?? { id: item.productId, title: item.productTitle, revenue: 0, orders: 0 };
      entry.revenue += item.unitPrice * item.quantity;
      if (!seen.has(item.productId)) {
        entry.orders += 1;
        seen.add(item.productId);
      }
      products.set(item.productId, entry);
    }
  }
  const topProducts = [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  return { period, totalOrders: counted.length, avgOrderValue, ordersByStatus, revenue: { daily }, topCities, topProducts };
}

// ---------------------------------------------------------------------------------------------------------------------
// The fixture: oldest first, as a collection holds its rows.

let seq = 0;
const line = (productId: string, productTitle: string, unitPrice: number, quantity: number) => ({ productId, productTitle, unitPrice, quantity });
function order(daysAgo: number, status: string, city: string | null, total: number, items: Row[], store = STORE): Row {
  seq += 1;
  return { _id: '65a0000000000000000e' + String(seq).padStart(4, '0'), store, status, city, total, items, createdAt: new Date(NOW.getTime() - daysAgo * DAY + seq) };
}

function fixture(): Row[] {
  seq = 0;
  const cities = ['Karachi', 'Lahore', ' Karachi ', 'Quetta', 'Multan', 'Peshawar', 'Sialkot', 'abbottabad', 'Abbottabad', '', null];
  const statuses = ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'];
  const rows: Row[] = [];
  rows.push(order(120, 'delivered', 'Karachi', 9999, [line(P1, 'Shirt', 999, 10)]));
  rows.push(order(89, 'delivered', 'Hyderabad', 1500, [line(P3, 'Cap', 500, 3)]));
  rows.push(order(45, 'delivered', 'Lahore', 2400, [line(P2, 'Shawl', 1200, 2)]));
  for (let i = 0; i < 40; i += 1) {
    const status = statuses[i % statuses.length]!;
    const items = i % 3 === 0 ? [line(P1, 'Shirt', 1000, 1), line(P1, 'Shirt (blue)', 1100, 1), line(P2, 'Shawl', 1200, 1)] : i % 3 === 1 ? [line(P3, 'Cap', 500, 2)] : [line(P2, 'Shawl', 1200, 1)];
    rows.push(order(28 - Math.floor(i * 0.7), status, cities[i % cities.length]!, 700 + i * 13, items));
  }
  // Two products with the same revenue: the one sold first comes first.
  rows.push(order(0, 'confirmed', 'Karachi', 5000, [line('x-late', 'Late', 7000, 1)]));
  rows.push(order(0, 'confirmed', 'Karachi', 5000, [line('x-later', 'Later', 7000, 1)]));
  rows.push(order(0, 'cancelled', 'Karachi', 100000, [line(P1, 'Shirt', 100000, 1)]));
  rows.push(order(1, 'delivered', 'Karachi', 4242, [line(P1, 'Shirt', 4242, 1)], OTHER));
  return rows;
}

let orders: Row[];
let stats: Row[];
let views: Row[];
let products: Row[];
let diskUse: boolean[];
let pipelines: Row[][];
let restore: () => void = () => {};

const query = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  orders = fixture();
  stats = [];
  views = [];
  products = [
    { _id: P1, store: STORE, title: 'Lawn Shirt', slug: 'lawn-shirt' },
    { _id: P2, store: STORE, title: 'Winter Shawl', slug: 'winter-shawl' },
    { _id: P3, store: OTHER, title: 'Foreign', slug: 'cap' },
  ];
  diskUse = [];
  pipelines = [];
  const O = Order as any;
  const D = DailyStat as any;
  const V = ProductDailyStat as any;
  const P = Product as any;
  const saved = { o: O.aggregate, of: O.find, d: D.find, v: V.aggregate, p: P.find };
  O.aggregate = (pipeline: Row[]) => (pipelines.push(pipeline), aggregateResult(() => orders, pipeline, (allowed) => diskUse.push(allowed)));
  O.find = () => assert.fail('no order is loaded into memory');
  D.find = (filter: Row) => query(() => stats.filter((row) => matchDoc(row, filter)));
  V.aggregate = async (pipeline: Row[]) => runPipeline(views, pipeline);
  P.find = (filter: Row) => query(() => products.filter((row) => matchDoc(row, filter)));
  restore = () => {
    O.aggregate = saved.o;
    O.find = saved.of;
    D.find = saved.d;
    V.aggregate = saved.v;
    P.find = saved.p;
  };
});
afterEach(() => restore());

const own = () => orders.filter((row) => row.store === STORE);
const withoutNew = (out: any) => ({
  period: out.period,
  totalOrders: out.totalOrders,
  avgOrderValue: out.avgOrderValue,
  ordersByStatus: out.ordersByStatus,
  revenue: { daily: out.revenue.daily.map(({ date, amount }: Row) => ({ date, amount })) },
  topCities: out.topCities,
  topProducts: out.topProducts,
});

for (const period of ['7d', '30d', '90d'] as const) {
  test('the aggregation EQUALS the old in-memory computation on the same orders, ' + period, async () => {
    const out = await buildAnalytics(STORE, period, NOW);
    assert.deepEqual(withoutNew(out), oldAnalytics(own(), period, NOW));
    assert.equal(analyticsSchema.safeParse(out).success, true);
    assert.ok(out.totalOrders > 0 && out.topProducts.length > 0);
  });
}

test('the equality also holds with no orders at all', async () => {
  orders = [];
  assert.deepEqual(withoutNew(await buildAnalytics(STORE, '7d', NOW)), oldAnalytics([], '7d', NOW));
});

test('every pipeline starts with $match on the store and the start of the period, and may use the disk', async () => {
  await buildAnalytics(STORE, '30d', NOW);
  assert.equal(pipelines.length, 3);
  for (const pipeline of pipelines) {
    const match = pipeline[0]!.$match;
    assert.ok(match.store instanceof mongoose.Types.ObjectId);
    assert.equal(String(match.store), STORE);
    assert.equal(match.createdAt.$gte.toISOString(), '2026-10-27T00:00:00.000Z');
  }
  assert.deepEqual(diskUse, [true, true, true]);
  assert.deepEqual(Object.values(PERIOD_DAYS), [7, 30, 90], 'the range can never be longer than 90 days');
  assert.equal(periodStart(NOW, 90).toISOString(), '2026-08-28T00:00:00.000Z');
});

test('orders per day count every order but a cancelled one; the rule is one helper', async () => {
  const out = await buildAnalytics(STORE, '7d', NOW);
  assert.equal(out.revenue.daily.reduce((sum, day) => sum + day.orders, 0), out.totalOrders);
  assert.deepEqual([countsAsOrder('returned'), countsAsOrder('cancelled'), countsAsRevenue('returned'), countsAsRevenue('pending')], [true, false, false, true]);
  const route = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'analytics', 'route.ts'), 'utf8');
  assert.doesNotMatch(route, /Order\.find|assertCan\(ctx\.actor, 'read', 'orders'\)/, 'no unbounded read, and the admin read of the orders row is gone');
  assert.match(route, /capability: 'analytics\.read'/);
});

test('percentages: one decimal, 0 when there is nothing to divide by, never above 100', () => {
  assert.equal(percent(1, 3), 33.3);
  assert.equal(percent(2, 3), 66.7);
  assert.equal(percent(0, 10), 0);
  assert.equal(percent(5, 0), 0);
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(12, 10), 100);
});

test('the funnel with no data, one day, a divisor of 0 and a step larger than the one before', () => {
  const none = funnelOf([]);
  assert.deepEqual(none.steps.map((s) => [s.key, s.count, s.fromPrevious, s.fromStart]), [
    ['visits', 0, null, 0],
    ['productViews', 0, 0, 0],
    ['addToCart', 0, 0, 0],
    ['checkoutStarts', 0, 0, 0],
    ['orders', 0, 0, 0],
  ]);
  assert.equal(none.overall, 0);

  const one = funnelOf([{ visits: 200, productViews: 150, addToCart: 30, checkoutStarts: 12, orders: 7 }]);
  assert.deepEqual(one.steps.map((s) => s.fromPrevious), [null, 75, 20, 40, 58.3]);
  assert.deepEqual(one.steps.map((s) => s.fromStart), [100, 75, 15, 6, 3.5]);
  assert.equal(one.overall, 3.5);

  // Orders without a counted visit (Do Not Track): the divisor is 0 for the first step and the display never passes 100.
  const odd = funnelOf([{ visits: 0, productViews: 5, orders: 2 }, { visits: 2, productViews: 10, addToCart: 0, orders: 3 }]);
  assert.deepEqual(odd.steps.map((s) => s.count), [2, 15, 0, 0, 5]);
  assert.deepEqual(odd.steps.map((s) => s.fromPrevious), [null, 100, 0, 0, 0]);
  assert.equal(odd.overall, 100);
});

test('the funnel and the traffic come from the counters of the period, visits filled with 0 for days without a row', async () => {
  stats = [
    { store: STORE, day: '2026-11-19', visits: 10, productViews: 4, addToCart: 2, checkoutStarts: 1, orders: 1 },
    { store: STORE, day: '2026-11-25', visits: 5, orders: 1 },
    { store: STORE, day: '2026-11-18', visits: 1000 },
    { store: OTHER, day: '2026-11-25', visits: 1000 },
  ];
  const out = await buildAnalytics(STORE, '7d', NOW);
  assert.deepEqual(out.traffic.map((d) => [d.date, d.visits]), [
    ['2026-11-19', 10], ['2026-11-20', 0], ['2026-11-21', 0], ['2026-11-22', 0], ['2026-11-23', 0], ['2026-11-24', 0], ['2026-11-25', 5],
  ]);
  assert.deepEqual(out.funnel.steps.map((s) => s.count), [15, 4, 2, 1, 2]);
});

test('top products by views (the counters) and by orders (the order lines), joined with the name and slug of this store only', async () => {
  views = [
    { store: new mongoose.Types.ObjectId(STORE), productSlug: 'lawn-shirt', day: '2026-11-24', views: 3 },
    { store: new mongoose.Types.ObjectId(STORE), productSlug: 'lawn-shirt', day: '2026-11-25', views: 4 },
    { store: new mongoose.Types.ObjectId(STORE), productSlug: 'removed-product', day: '2026-11-25', views: 20 },
    { store: new mongoose.Types.ObjectId(OTHER), productSlug: 'cap', day: '2026-11-25', views: 99 },
  ];
  const out = await buildAnalytics(STORE, '30d', NOW);
  assert.deepEqual(out.topByViews, [
    { name: 'removed-product', slug: 'removed-product', views: 20 },
    { name: 'Lawn Shirt', slug: 'lawn-shirt', views: 7 },
  ]);
  const shawl = out.topByOrders.find((row) => row.slug === 'winter-shawl')!;
  assert.equal(shawl.name, 'Winter Shawl');
  assert.deepEqual(out.topByOrders.map((row) => row.orders), [...out.topByOrders.map((row) => row.orders)].sort((a, b) => b - a));
  const cap = out.topByOrders.find((row) => row.name === 'Cap')!;
  assert.equal(cap.slug, null, "another store's product is never joined");
  for (const row of out.topByOrders) assert.deepEqual(Object.keys(row).sort(), ['name', 'orders', 'slug']);
});
