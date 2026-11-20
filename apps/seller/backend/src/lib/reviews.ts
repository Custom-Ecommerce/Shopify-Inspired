import type {
  ProductReviewsResponse,
  PublicReview,
  ReviewCreateRequest,
  ReviewEligibility,
  ReviewIneligibleReason,
  SellerReview,
} from '@markaz/contracts';
import { REVIEW_DEFAULT_DISPLAY_NAME, REVIEW_INELIGIBLE_MESSAGES, REVIEW_NOT_ELIGIBLE } from '@/lib/contracts';
import { isDuplicateKeyError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import type { ReturnableOrder } from '@/lib/return-service';
import { deliveredAtOf } from '@/lib/returns';
import { Product, Review, assertCan } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';

/*
 * Sprint 5 EP-21 (D-107, D-108): what the review routes share. A review is written by a shopper of a DELIVERED order (the credential is the order
 * number plus the phone, like a return), published at once, escaped by every output, answered once by the seller, hidden or shown by an admin.
 * The average and the count live on the product (avgRating, reviewCount, which the storefront DTO already carries) and are recomputed from the
 * approved reviews whenever one is published, hidden or shown again.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : {});
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const asDate = (value: unknown): Date | null => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date : null;
};
const iso = (value: unknown): string | null => asDate(value)?.toISOString() ?? null;

const notEligible = (reason: ReviewIneligibleReason, field?: string): StorefrontHttpError =>
  new StorefrontHttpError(422, REVIEW_NOT_ELIGIBLE, REVIEW_INELIGIBLE_MESSAGES[reason], { reason, ...(field === undefined ? {} : { field }) });

// ---------------------------------------------------------------------------------------------------------------- eligibility

/** True once the order has been delivered (the ONE delivered-date helper, D-108). A later move to returned keeps the delivery on record. */
export function wasDelivered(order: Pick<ReturnableOrder, 'statusHistory'>): boolean {
  return deliveredAtOf({ statusHistory: order.statusHistory }) !== null;
}

/** The products of an order, once each, in order of first appearance (the variants of one product share one review). */
export function reviewableProducts(order: Pick<ReturnableOrder, 'lines'>): Array<{ productId: string; productTitle: string }> {
  const seen = new Set<string>();
  const out: Array<{ productId: string; productTitle: string }> = [];
  for (const line of order.lines) {
    const key = line.productId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ productId: line.productId, productTitle: line.productTitle });
  }
  return out;
}

/** The products of this order that already have a review (any status: a hidden review still counts, so one order reviews a product once). */
async function reviewedProducts(storeId: string, orderId: unknown): Promise<Set<string>> {
  const rows = (await Review.find({ store: oid(storeId), order: orderId }).select('product').lean()) as unknown as Row[];
  return new Set(rows.map((row) => String(row.product).toLowerCase()));
}

/** GET review-eligibility: the delivered products not yet reviewed. No name, phone or address comes back. */
export async function reviewEligibilityOf(storeId: string, order: ReturnableOrder): Promise<ReviewEligibility> {
  if (!wasDelivered(order)) return { eligible: false, reason: 'not_delivered', items: [] };
  const done = await reviewedProducts(storeId, order._id);
  const items = reviewableProducts(order).filter((product) => !done.has(product.productId.toLowerCase()));
  if (items.length === 0) return { eligible: false, reason: 'nothing_to_review', items: [] };
  return { eligible: true, reason: null, items };
}

// -------------------------------------------------------------------------------------------------------------------- create

/** What the system actor writes on a new review: every field the policy's create row for `system` allows. */
const CREATE_FIELDS = ['product', 'store', 'order', 'rating', 'title', 'body', 'displayName', 'verified', 'status'];

/**
 * POST reviews: checks that the order was delivered and that the product is one of its lines, then saves ONE review (published at once). The unique
 * { order, product } index decides two parallel posts: the loser answers 422 already_reviewed. Returns the stored review row.
 */
export async function createReview(storeId: string, order: ReturnableOrder, request: ReviewCreateRequest): Promise<Row> {
  if (!wasDelivered(order)) throw notEligible('not_delivered');
  const product = reviewableProducts(order).find((candidate) => candidate.productId.toLowerCase() === request.productId.toLowerCase());
  if (!product) throw notEligible('unknown_product', 'productId');
  if ((await reviewedProducts(storeId, order._id)).has(product.productId.toLowerCase())) throw notEligible('already_reviewed', 'productId');

  assertCan('system', 'create', 'reviews', CREATE_FIELDS);
  const title = request.title === undefined || request.title === null || request.title === '' ? null : request.title;
  const displayName = request.displayName === undefined || request.displayName === null || request.displayName === '' ? REVIEW_DEFAULT_DISPLAY_NAME : request.displayName;
  try {
    return (await Review.create({
      product: oid(product.productId),
      store: oid(storeId),
      order: order._id,
      customer: null,
      rating: request.rating,
      title,
      body: request.body,
      displayName,
      verified: true,
      status: 'approved',
    })) as unknown as Row;
  } catch (err) {
    if (isDuplicateKeyError(err)) throw notEligible('already_reviewed', 'productId');
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------- the average and the count

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/** The average (one decimal) and the count of a product's APPROVED reviews. */
export async function ratingSummary(storeId: string, productId: string): Promise<{ average: number; count: number }> {
  const rows = (await Review.aggregate([
    { $match: { store: oid(storeId), product: oid(productId), status: 'approved' } },
    { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$rating' } } },
  ])) as unknown as Array<{ count?: number; sum?: number }>;
  const count = rows[0]?.count ?? 0;
  return { average: count === 0 ? 0 : oneDecimal((rows[0]?.sum ?? 0) / count), count };
}

/**
 * Writes the product's avgRating and reviewCount from its approved reviews (what the storefront's product DTO and the rating sort read). Best
 * effort: a failure is logged and never undoes the review, the hide or the show that caused it. Returns whether it was written.
 */
export async function recomputeProductRating(storeId: string, productId: string): Promise<boolean> {
  try {
    const { average, count } = await ratingSummary(storeId, productId);
    await Product.updateOne({ _id: oid(productId), store: oid(storeId) }, { $set: { avgRating: average, reviewCount: count } });
    return true;
  } catch (err) {
    console.error('[seller-backend] could not recompute a product rating', err instanceof Error ? err.name : 'unknown');
    return false;
  }
}

// --------------------------------------------------------------------------------------------------------------------- reading

/** A review as the storefront shows it: no customer, order, phone, email or status. Built field by field. */
export function toPublicReview(doc: unknown): PublicReview {
  const row = record(doc);
  const reply = record(row.reply);
  const replyText = text(reply.text);
  return {
    id: String(row._id ?? ''),
    rating: Math.min(5, Math.max(1, Math.round(Number(row.rating) || 1))),
    title: text(row.title),
    body: typeof row.body === 'string' ? row.body : '',
    displayName: text(row.displayName) ?? REVIEW_DEFAULT_DISPLAY_NAME,
    verified: row.verified === true,
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    reply: replyText === null ? null : { text: replyText, at: iso(reply.at) ?? new Date(0).toISOString() },
  };
}

/** The product of a slug in this store (Live only), or null. The caller supplies the Live filter. */
export async function liveProductIdOf(filter: Record<string, unknown>, slug: string): Promise<string | null> {
  const row = (await Product.findOne({ ...filter, slug }).select('_id').lean()) as unknown as Row | null;
  return row ? String(row._id) : null;
}

/** GET products/:slug/reviews: approved reviews, newest first, paged, with the summary of ALL approved ones. */
export async function productReviews(storeId: string, productId: string, page: number, limit: number): Promise<ProductReviewsResponse> {
  const filter = { store: oid(storeId), product: oid(productId), status: 'approved' };
  const [rows, summary] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean() as unknown as Promise<Row[]>,
    ratingSummary(storeId, productId),
  ]);
  return { data: { reviews: rows.map(toPublicReview), summary }, page, totalPages: Math.ceil(summary.count / limit) };
}

/** A review as the seller reads it. The product's title and slug come from the caller's lookup. */
export function toSellerReview(doc: unknown, product: { title: string | null; slug: string | null } | null): SellerReview {
  const row = record(doc);
  const reply = record(row.reply);
  const replyText = text(reply.text);
  const status = row.status === 'rejected' || row.status === 'pending' ? row.status : 'approved';
  return {
    id: String(row._id ?? ''),
    product: { id: String(row.product ?? ''), title: product?.title ?? null, slug: product?.slug ?? null },
    rating: Math.round(Number(row.rating) || 1),
    title: text(row.title),
    body: typeof row.body === 'string' ? row.body : '',
    displayName: text(row.displayName) ?? REVIEW_DEFAULT_DISPLAY_NAME,
    verified: row.verified === true,
    status,
    reply: replyText === null ? null : { text: replyText, at: iso(reply.at) ?? new Date(0).toISOString(), editedAt: iso(reply.editedAt) },
    hiddenReason: text(row.hiddenReason),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/** The titles and slugs of the products these reviews are about, one query. */
export async function productsOf(rows: Row[]): Promise<Map<string, { title: string | null; slug: string | null }>> {
  const ids = [...new Set(rows.map((row) => String(row.product)))];
  if (ids.length === 0) return new Map();
  const products = (await Product.find({ _id: { $in: ids } }).select('title slug').lean()) as unknown as Row[];
  return new Map(products.map((product) => [String(product._id), { title: text(product.title), slug: text(product.slug) }]));
}
