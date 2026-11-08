import type { Types } from 'mongoose';
import { PRODUCT_TRASH_RETENTION_DAYS } from '@/lib/contracts';
import { ArchivedReview, Product, Review, assertCan } from '@/lib/services';

const DAY_MS = 24 * 60 * 60 * 1000;
/** One run of the retention job purges at most this many. The rest wait for the next run, oldest first. */
const RETENTION_BATCH = 200;

export const trashPurgeDate = (deletedAt: Date): Date => new Date(deletedAt.getTime() + PRODUCT_TRASH_RETENTION_DAYS * DAY_MS);

/** Whole days until the purge, counted up, so the last day still reads 1. */
export const trashDaysLeft = (deletedAt: Date, now: Date): number =>
  Math.max(0, Math.ceil((trashPurgeDate(deletedAt).getTime() - now.getTime()) / DAY_MS));

/** A product deleted before this moment has been in trash for more than the retention period. */
export const retentionCutoff = (now: Date): Date => new Date(now.getTime() - PRODUCT_TRASH_RETENTION_DAYS * DAY_MS);

/** What a purge needs to know about a product, also what its archived reviews remember. */
export interface PurgeableProduct {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  title: string;
  slug: string;
}

interface ReviewRow {
  _id: Types.ObjectId;
  rating: number;
  title?: string | null;
  body: string;
  createdAt: Date;
}

/**
 * The archived shape (A-004). It is built field by field, never by copying and deleting, so a field added to reviews
 * later stays out until someone decides it may come along.
 */
export function toArchivedReview(review: ReviewRow, product: PurgeableProduct, now: Date) {
  return {
    rating: review.rating,
    title: review.title ?? null,
    body: review.body,
    reviewedAt: review.createdAt,
    product: { title: product.title, slug: product.slug, store: product.store },
    archivedAt: now,
  };
}

/** Keyed on the id the review had, so a purge that is retried writes each review once. */
async function archiveProductReviews(product: PurgeableProduct, now: Date): Promise<void> {
  assertCan('system', 'create', 'archivedReviews');
  const reviews = (await Review.find({ product: product._id, store: product.store })
    .select('rating title body createdAt')
    .lean()) as unknown as ReviewRow[];
  if (reviews.length === 0) return;
  await ArchivedReview.bulkWrite(
    reviews.map((review) => ({
      updateOne: {
        filter: { _id: review._id },
        update: { $setOnInsert: toArchivedReview(review, product, now) },
        upsert: true,
      },
    })),
  );
}

/**
 * Removes a trashed product for good: the document, and with it its variants and its links to media. The media library
 * keeps the files. Order lines hold their own snapshot, and stock history stays.
 *
 * The order matters. Reviews are archived first, so a failure loses nothing. The delete only matches a product still in
 * trash, so one restored in the meantime survives with its reviews, and false reports that. Live reviews go last.
 */
export async function purgeProduct(product: PurgeableProduct, now: Date): Promise<boolean> {
  await archiveProductReviews(product, now);
  const removed = await Product.deleteOne({ _id: product._id, store: product.store, deletedAt: { $ne: null } });
  if (removed.deletedCount === 0) return false;
  await Review.deleteMany({ product: product._id, store: product.store });
  return true;
}

/** Hook for the purge email (D-010, D-011). Nothing implements it until the Notification epic. */
export interface TrashPurgeNotifier {
  beforePurge(product: PurgeableProduct): Promise<void>;
}

const noNotifier: TrashPurgeNotifier = { beforePurge: async () => {} };

export interface RetentionResult {
  purged: number;
  failed: number;
  /** True when the batch was full, so older items may remain for the next run. */
  more: boolean;
}

/**
 * What the retention job may purge: in trash for more than the retention period, and neither taken down nor deleted by an
 * admin. Those two keep their record for good, however long they sit in trash (D-058, after D-040 and D-052): a seller
 * must not make a moderation record disappear by trashing the product and waiting a year. The rule is in the query, so a
 * kept product never reaches the purge, the notifier, or the batch limit.
 */
export const retentionFilter = (now: Date): Record<string, unknown> => ({
  deletedAt: { $lt: retentionCutoff(now) },
  moderation: null,
  'deletedBy.role': { $ne: 'admin' },
});

/** The retention job. `now` is a parameter so the 365-day boundary can be tested and is never read from a request. */
export async function purgeExpiredProducts(now: Date, notifier: TrashPurgeNotifier = noNotifier): Promise<RetentionResult> {
  assertCan('system', 'delete', 'productLifecycle');
  const expired = (await Product.find(retentionFilter(now))
    .select('store title slug')
    .sort({ deletedAt: 1 })
    .limit(RETENTION_BATCH)
    .lean()) as unknown as PurgeableProduct[];

  let purged = 0;
  let failed = 0;
  for (const product of expired) {
    try {
      await notifier.beforePurge(product);
      if (await purgeProduct(product, now)) purged += 1;
    } catch (err) {
      failed += 1;
      console.error('[seller-backend] could not purge a trashed product', { productId: String(product._id) }, err);
    }
  }
  return { purged, failed, more: expired.length === RETENTION_BATCH };
}
