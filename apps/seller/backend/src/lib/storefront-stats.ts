import mongoose from 'mongoose';
import type { ProductViews, StorefrontEvent } from '@markaz/contracts';
import { PRODUCT_STAT_SLUGS_PER_DAY, STAT_RETENTION_DAYS } from '@/lib/contracts';
import { isDuplicateKeyError } from '@/lib/http';
import { runAfterResponse } from '@/lib/notifications';
import { DailyStat, Product, ProductDailyStat } from '@/lib/services';
import { liveProductFilter } from '@/lib/storefront/live-product';

/*
 * Sprint 8 (S8-B6, D-118): the writes and reads of the anonymous counters. Every write is an atomic $inc upsert on (store, UTC day). Nothing about a visitor
 * is taken, so nothing can be stored: no cookie, no id, no IP.
 */

type CounterField = 'visits' | 'productViews' | 'addToCart' | 'checkoutStarts' | 'orders';

const EVENT_FIELD: Record<StorefrontEvent, CounterField> = {
  page_view: 'visits',
  product_view: 'productViews',
  add_to_cart: 'addToCart',
  checkout_start: 'checkoutStarts',
};

export const statDay = (now: Date): string => now.toISOString().slice(0, 10);

/** The day plus the retention: when MongoDB's TTL monitor removes the row. */
export const statExpiry = (day: string): Date => new Date(Date.parse(day + 'T00:00:00.000Z') + STAT_RETENTION_DAYS * 86_400_000);

interface Upsertable {
  updateOne(filter: never, update: never, options?: never): PromiseLike<unknown>;
}

async function bump(model: Upsertable, filter: Record<string, unknown>, field: string, day: string): Promise<void> {
  const write = () => model.updateOne(filter as never, { $inc: { [field]: 1 }, $setOnInsert: { expiresAt: statExpiry(day) } } as never, { upsert: true } as never);
  try {
    await write();
  } catch (err) {
    // Two first writes of a day both tried to insert: the loser's retry finds the row and counts.
    if (!isDuplicateKeyError(err)) throw err;
    await write();
  }
}

const bumpDaily = (storeId: string, field: CounterField, day: string): Promise<void> => bump(DailyStat as unknown as Upsertable, { store: storeId, day }, field, day);

/** One view of one product, unless the store already has a counter for PRODUCT_STAT_SLUGS_PER_DAY other products today. */
async function bumpProduct(storeId: string, productSlug: string, day: string): Promise<void> {
  const existing = (await ProductDailyStat.updateOne({ store: storeId, productSlug, day } as never, { $inc: { views: 1 } } as never)) as { matchedCount?: number };
  if (existing.matchedCount === 1) return;
  if ((await ProductDailyStat.countDocuments({ store: storeId, day } as never)) >= PRODUCT_STAT_SLUGS_PER_DAY) return;
  await bump(ProductDailyStat as unknown as Upsertable, { store: storeId, productSlug, day }, 'views', day);
}

/**
 * Counts one storefront event of a live store. False when it was ignored: a product view of a slug that is no live product of this store counts nothing.
 * Throws on a database failure (the route answers 503: success is only said after the write).
 */
export async function recordStorefrontEvent(storeId: string, event: StorefrontEvent, productSlug: string | undefined, now: Date = new Date()): Promise<boolean> {
  const day = statDay(now);
  if (event === 'product_view') {
    const product = await Product.exists({ ...liveProductFilter(storeId), slug: productSlug } as never);
    if (!product) return false;
    await bumpDaily(storeId, 'productViews', day);
    await bumpProduct(storeId, productSlug as string, day);
    return true;
  }
  await bumpDaily(storeId, EVENT_FIELD[event], day);
  return true;
}

/** One new order of a store. Never throws: counting can never fail or delay an order. */
export async function recordOrderStat(storeId: string, now: Date = new Date()): Promise<void> {
  try {
    await bumpDaily(storeId, 'orders', statDay(now));
  } catch (err) {
    console.error('[seller-backend] could not count an order', err instanceof Error ? err.name : 'unknown');
  }
}

/** Called by order creation, for a NEW order only (a replayed request was already counted). */
export function countOrder(storeId: string, now: Date = new Date()): void {
  runAfterResponse('order_stat', () => recordOrderStat(storeId, now));
}

/** Views per product slug over UTC days from..to (both included), most viewed first. Only this store's rows. */
export async function productViewsFor(storeId: string, range: { from: string; to: string }): Promise<ProductViews[]> {
  const rows = (await ProductDailyStat.aggregate([
    { $match: { store: new mongoose.Types.ObjectId(storeId), day: { $gte: range.from, $lte: range.to } } },
    { $group: { _id: '$productSlug', views: { $sum: '$views' } } },
    { $sort: { views: -1, _id: 1 } },
  ] as never)) as unknown as Array<{ _id: unknown; views: number }>;
  return rows.map((row) => ({ productSlug: String(row._id), views: row.views }));
}

/**
 * The products with their view count of the range, read from the counters (the stored Product.viewCount was never written and is replaced here). A product
 * nobody viewed has 0. For the analytics read of S8-B7.
 */
export async function withViewCounts<T extends { slug: string }>(storeId: string, products: readonly T[], range: { from: string; to: string }): Promise<Array<T & { viewCount: number }>> {
  const views = new Map((await productViewsFor(storeId, range)).map((row) => [row.productSlug, row.views]));
  return products.map((product) => ({ ...product, viewCount: views.get(product.slug) ?? 0 }));
}
