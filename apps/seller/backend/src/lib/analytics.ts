import mongoose, { type PipelineStage } from 'mongoose';
import type { Analytics, AnalyticsFunnel, AnalyticsPeriod } from '@markaz/contracts';
import { countsAsOrder, countsAsRevenue, NOT_AN_ORDER, NOT_REVENUE } from '@/lib/analytics-rules';
import { DailyStat, Order, Product } from '@/lib/services';
import { productViewsFor } from '@/lib/storefront-stats';

/*
 * Sprint 8 (S8-B7, D-118): a store's analytics, worked out by the database. Every read starts with $match on the store and the date range (index
 * {store, createdAt}); the period is at most 90 days; no order is loaded into memory. The numbers of orders are the same as the earlier in-memory version
 * (test/analytics.test.ts holds the two together). Days are UTC.
 */

type Row = Record<string, any>;

export const PERIOD_DAYS: Readonly<Record<AnalyticsPeriod, number>> = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });
const DAY_MS = 86_400_000;
export const TOP_CITIES = 5;
export const TOP_PRODUCTS = 10;
/** The most distinct city spellings read back to rank (the ranking itself is by orders, then name). */
const CITY_GROUPS_MAX = 500;

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** UTC midnight of the first day of a period that ends today. */
export function periodStart(now: Date, days: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

export function dayKeys(since: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => dayOf(new Date(since.getTime() + i * DAY_MS)));
}

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);

// ---------------------------------------------------------------------------------------------------------------------
// Pipelines

/** Orders and money by UTC day and status: at most 90 days x 7 statuses of rows. */
export function byDayStatusPipeline(store: unknown, since: Date): Row[] {
  return [
    { $match: { store, createdAt: { $gte: since } } },
    {
      $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, status: '$status' },
        count: { $sum: 1 },
        total: { $sum: { $ifNull: ['$total', 0] } },
      },
    },
  ];
}

export function cityPipeline(store: unknown, since: Date): Row[] {
  return [
    { $match: { store, createdAt: { $gte: since }, status: { $nin: [...NOT_AN_ORDER] } } },
    { $group: { _id: { $trim: { input: { $ifNull: ['$city', ''] } } }, orders: { $sum: 1 } } },
    { $match: { _id: { $ne: '' } } },
    { $sort: { orders: -1, _id: 1 } },
    { $limit: CITY_GROUPS_MAX },
  ];
}

/**
 * Revenue and orders per product, from the order lines. First per (order, product) so an order with two lines of one product counts once; then per product. The
 * name is the one on the oldest line, and equal revenues keep the order of first sale.
 */
export function productPipeline(store: unknown, since: Date): Row[] {
  return [
    { $match: { store, createdAt: { $gte: since }, status: { $nin: [...NOT_REVENUE] } } },
    { $unwind: { path: '$items', includeArrayIndex: 'line' } },
    { $sort: { createdAt: 1, _id: 1, line: 1 } },
    {
      $group: {
        _id: { order: '$_id', product: '$items.productId' },
        revenue: { $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] } },
        title: { $first: '$items.productTitle' },
        at: { $first: '$createdAt' },
        line: { $first: '$line' },
      },
    },
    { $sort: { at: 1, '_id.order': 1, line: 1 } },
    {
      $group: {
        _id: '$_id.product',
        revenue: { $sum: '$revenue' },
        orders: { $sum: 1 },
        title: { $first: '$title' },
        firstAt: { $first: '$at' },
        firstOrder: { $first: '$_id.order' },
        firstLine: { $first: '$line' },
      },
    },
    {
      $facet: {
        byRevenue: [{ $sort: { revenue: -1, firstAt: 1, firstOrder: 1, firstLine: 1 } }, { $limit: TOP_PRODUCTS }],
        byOrders: [{ $sort: { orders: -1, revenue: -1, _id: 1 } }, { $limit: TOP_PRODUCTS }],
      },
    },
  ];
}

const aggregate = (pipeline: Row[]): Promise<Row[]> => Order.aggregate(pipeline as unknown as PipelineStage[]).allowDiskUse(true) as unknown as Promise<Row[]>;

// ---------------------------------------------------------------------------------------------------------------------
// Funnel

export const FUNNEL_STEPS = ['visits', 'productViews', 'addToCart', 'checkoutStarts', 'orders'] as const;

/** part of whole as a percentage with one decimal: 0 when there is nothing to divide by, and never shown above 100. */
export function percent(part: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.round((part / total) * 1000) / 10);
}

/**
 * The funnel of the counters of some days. These are COUNTERS, NOT PEOPLE: one visitor can view many products, and an order can come without a counted visit
 * (a browser with Do Not Track), so a step can be larger than the one before; the percentage is then shown as 100.
 */
export function funnelOf(rows: readonly Row[]): AnalyticsFunnel {
  const sum = (field: string) => rows.reduce((total, row) => total + Math.max(0, whole(row[field])), 0);
  const counts = FUNNEL_STEPS.map(sum);
  return {
    steps: FUNNEL_STEPS.map((key, i) => ({
      key,
      count: counts[i]!,
      fromPrevious: i === 0 ? null : percent(counts[i]!, counts[i - 1]!),
      fromStart: percent(counts[i]!, counts[0]!),
    })),
    overall: percent(counts[counts.length - 1]!, counts[0]!),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The answer

/** The order side of the answer, from the grouped rows. */
export function orderSummary(grouped: readonly Row[], days: readonly string[]) {
  const ordersByStatus: Record<string, number> = {};
  const money = new Map<string, number>(days.map((day) => [day, 0]));
  const orders = new Map<string, number>(days.map((day) => [day, 0]));
  let totalOrders = 0;
  let revenueTotal = 0;
  let revenueOrders = 0;
  for (const row of grouped) {
    const day = String(row._id?.day);
    const status = String(row._id?.status);
    const count = whole(row.count);
    const total = Number(row.total ?? 0);
    ordersByStatus[status] = (ordersByStatus[status] ?? 0) + count;
    if (countsAsOrder(status)) {
      totalOrders += count;
      if (orders.has(day)) orders.set(day, orders.get(day)! + count);
    }
    if (countsAsRevenue(status)) {
      revenueTotal += total;
      revenueOrders += count;
      if (money.has(day)) money.set(day, money.get(day)! + total);
    }
  }
  return {
    totalOrders,
    avgOrderValue: revenueOrders ? Math.round(revenueTotal / revenueOrders) : 0,
    ordersByStatus,
    daily: days.map((date) => ({ date, amount: Math.round(money.get(date)!), orders: orders.get(date)! })),
  };
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export async function buildAnalytics(storeId: string, period: AnalyticsPeriod, now: Date = new Date()): Promise<Analytics> {
  const days = PERIOD_DAYS[period];
  const since = periodStart(now, days);
  const keys = dayKeys(since, days);
  const range = { from: keys[0]!, to: keys[keys.length - 1]! };
  // An aggregate casts nothing: the store is given as the rows hold it.
  const store = new mongoose.Types.ObjectId(storeId);

  const [grouped, cityRows, productRows, statRows, views] = await Promise.all([
    aggregate(byDayStatusPipeline(store, since)),
    aggregate(cityPipeline(store, since)),
    aggregate(productPipeline(store, since)),
    DailyStat.find({ store: storeId, day: { $gte: range.from, $lte: range.to } } as never)
      .select('day visits productViews addToCart checkoutStarts orders')
      .lean() as unknown as Promise<Row[]>,
    productViewsFor(storeId, range, TOP_PRODUCTS),
  ]);

  const summary = orderSummary(grouped, keys);
  const topCities = cityRows
    .map((row) => ({ city: String(row._id), orders: whole(row.orders) }))
    .sort((a, b) => b.orders - a.orders || a.city.localeCompare(b.city))
    .slice(0, TOP_CITIES);

  const byRevenue: Row[] = productRows[0]?.byRevenue ?? [];
  const byOrders: Row[] = productRows[0]?.byOrders ?? [];

  // Names and slugs of this store's products only.
  const ids = byOrders.map((row) => String(row._id)).filter((id) => OBJECT_ID.test(id));
  const slugs = views.map((row) => row.productSlug);
  const [ordered, viewed] = await Promise.all([
    ids.length === 0 ? [] : (Product.find({ store: storeId, _id: { $in: ids } } as never).select('title slug').lean() as unknown as Promise<Row[]>),
    slugs.length === 0 ? [] : (Product.find({ store: storeId, slug: { $in: slugs } } as never).select('title slug').lean() as unknown as Promise<Row[]>),
  ]);
  const byId = new Map(ordered.map((row) => [String(row._id), row]));
  const bySlug = new Map(viewed.map((row) => [String(row.slug), row]));

  const visits = new Map(statRows.map((row) => [String(row.day), whole(row.visits)]));

  return {
    period,
    totalOrders: summary.totalOrders,
    avgOrderValue: summary.avgOrderValue,
    ordersByStatus: summary.ordersByStatus,
    revenue: { daily: summary.daily },
    topCities,
    topProducts: byRevenue.map((row) => ({ id: String(row._id), title: String(row.title ?? ''), revenue: whole(row.revenue), orders: whole(row.orders) })),
    funnel: funnelOf(statRows),
    traffic: keys.map((date) => ({ date, visits: visits.get(date) ?? 0 })),
    // A product that is gone keeps its slug (views) or the name on the order (orders).
    topByViews: views.map((row) => ({ name: String(bySlug.get(row.productSlug)?.title ?? row.productSlug), slug: row.productSlug, views: row.views })),
    topByOrders: byOrders.map((row) => {
      const product = byId.get(String(row._id));
      return { name: String(product?.title ?? row.title ?? ''), slug: typeof product?.slug === 'string' ? product.slug : null, orders: whole(row.orders) };
    }),
  };
}
