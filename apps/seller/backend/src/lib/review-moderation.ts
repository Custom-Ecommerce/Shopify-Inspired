import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ModerationReview, ModerationReviewList, ReviewModerationListQuery } from '@markaz/contracts';
import { REVIEW_DEFAULT_DISPLAY_NAME, REVIEW_STATUS_CHANGED, reviewModerationListQuerySchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { readSignedRequest } from '@/lib/internal-signature';
import { oid } from '@/lib/ledger-aggregates';
import { connectSellerDb } from '@/lib/mongo';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { recomputeProductRating } from '@/lib/reviews';
import { Product, Review, Store, assertCan, writeAuditLog } from '@/lib/services';

/*
 * Sprint 5 EP-21.US01.T05 (D-108): the admin hides a review (status rejected, with a reason) and shows it again (status approved). Like the
 * product moderation (D-026) it is served to the admin console under /api/internal/moderation, signed with MODERATION_API_SECRET, and the
 * seller backend owns the write: the review lives in the seller database, and only this backend can purge the storefront's cache. Each action is
 * ONE compare-and-set on the status that was read, so two operators cannot both win, and a repeat finds nothing to do.
 */

type Row = Record<string, unknown>;
const NO_STORE = { 'Cache-Control': 'no-store' };
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

const reviewNotFound = (): HttpError => new HttpError(404, 'Review not found');

function toItem(row: Row, storeName: string | null, productTitle: string | null): ModerationReview {
  const status = row.status === 'rejected' || row.status === 'pending' ? row.status : 'approved';
  return {
    reviewId: String(row._id),
    storeId: String(row.store),
    storeName,
    productId: String(row.product),
    productTitle,
    rating: Math.round(Number(row.rating) || 1),
    title: text(row.title),
    body: typeof row.body === 'string' ? row.body : '',
    displayName: text(row.displayName) ?? REVIEW_DEFAULT_DISPLAY_NAME,
    status,
    hiddenReason: text(row.hiddenReason),
    hiddenAt: iso(row.hiddenAt),
    createdAt: iso(row.createdAt) ?? '',
  };
}

/** Store names and product titles only: an operator sees which store and product, and nothing about the seller or the shopper. */
async function names(rows: Row[]): Promise<{ stores: Map<string, string>; products: Map<string, string> }> {
  const storeIds = [...new Set(rows.map((row) => String(row.store)))];
  const productIds = [...new Set(rows.map((row) => String(row.product)))];
  const [stores, products] = await Promise.all([
    storeIds.length === 0 ? [] : ((await Store.find({ _id: { $in: storeIds } }).select('name').lean()) as unknown as Row[]),
    productIds.length === 0 ? [] : ((await Product.find({ _id: { $in: productIds } }).select('title').lean()) as unknown as Row[]),
  ]);
  return {
    stores: new Map(stores.map((store) => [String(store._id), String(store.name ?? '')])),
    products: new Map(products.map((product) => [String(product._id), String(product.title ?? '')])),
  };
}

async function single(row: Row): Promise<ModerationReview> {
  const lookup = await names([row]);
  return toItem(row, lookup.stores.get(String(row.store)) ?? null, lookup.products.get(String(row.product)) ?? null);
}

/**
 * The entry goes in before the change (the product moderation's rule): a failed entry stops the action, and a retry simply runs it. It holds ids
 * and the time only: no reason text, no name, no phone, no email (the reason lives on the review itself).
 */
async function audit(action: string, row: Row, adminId: string): Promise<void> {
  await writeAuditLog('review.' + action, 'review', String(row._id), 'admin:' + adminId, {
    storeId: String(row.store),
    reviewId: String(row._id),
    productId: String(row.product),
    at: new Date().toISOString(),
  });
}

async function after(row: Row): Promise<void> {
  await recomputeProductRating(String(row.store), String(row.product));
  revalidateStoreProduct(String(row.store), String(row.product));
}

export async function listModerationReviews(query: ReviewModerationListQuery): Promise<ModerationReviewList> {
  assertCan('admin', 'read', 'reviews');
  const filter: Record<string, unknown> = {
    ...(query.storeId ? { store: oid(query.storeId) } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [rows, totalDocs] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<Row[]>,
    Review.countDocuments(filter),
  ]);
  const lookup = await names(rows);
  return {
    docs: rows.map((row) => toItem(row, lookup.stores.get(String(row.store)) ?? null, lookup.products.get(String(row.product)) ?? null)),
    page: query.page,
    limit: query.limit,
    totalDocs,
    totalPages: Math.ceil(totalDocs / query.limit),
  };
}

/** Hides a shown review with a reason: status rejected, so it leaves the storefront and the product's average and count. A repeat is a no-op. */
export async function hideReview(input: { reviewId: string; reason: string }, adminId: string): Promise<ModerationReview> {
  assertCan('admin', 'update', 'reviews', ['status', 'hiddenReason', 'hiddenAt', 'hiddenBy']);
  const row = (await Review.findOne({ _id: input.reviewId }).lean()) as unknown as Row | null;
  if (!row) throw reviewNotFound();
  if (row.status === 'rejected') return single(row);

  await audit('hide', row, adminId);
  const updated = (await Review.findOneAndUpdate(
    { _id: input.reviewId, status: { $ne: 'rejected' } },
    { $set: { status: 'rejected', hiddenReason: input.reason, hiddenAt: new Date(), hiddenBy: /^[0-9a-f]{24}$/i.test(adminId) ? oid(adminId) : null } },
    { new: true },
  ).lean()) as unknown as Row | null;
  if (!updated) throw new HttpError(409, 'This review changed. Reload and try again.', REVIEW_STATUS_CHANGED);

  await after(updated);
  return single(updated);
}

/** Shows a hidden review again: status approved, the reason cleared. A repeat is a no-op. */
export async function unhideReview(input: { reviewId: string }, adminId: string): Promise<ModerationReview> {
  assertCan('admin', 'update', 'reviews', ['status', 'hiddenReason', 'hiddenAt', 'hiddenBy']);
  const row = (await Review.findOne({ _id: input.reviewId }).lean()) as unknown as Row | null;
  if (!row) throw reviewNotFound();
  if (row.status !== 'rejected') return single(row);

  await audit('unhide', row, adminId);
  const updated = (await Review.findOneAndUpdate(
    { _id: input.reviewId, status: 'rejected' },
    { $set: { status: 'approved', hiddenReason: null, hiddenAt: null, hiddenBy: null } },
    { new: true },
  ).lean()) as unknown as Row | null;
  if (!updated) throw new HttpError(409, 'This review changed. Reload and try again.', REVIEW_STATUS_CHANGED);

  await after(updated);
  return single(updated);
}

interface BodySchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** The route of one POST action: the signature first, then the body, and only then the database. */
export async function reviewModerationAction<T, R>(request: NextRequest, schema: BodySchema<T>, run: (input: T, adminId: string) => Promise<R>): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;
    let raw: unknown = null;
    try {
      raw = JSON.parse(signed.rawBody);
    } catch {
      raw = null;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({ message: issue.message, code: 'INVALID_REQUEST', path: issue.path.map(String).join('.') }));
      return NextResponse.json({ errors }, { status: 422, headers: NO_STORE });
    }
    await requireDatabase();
    return NextResponse.json(await run(parsed.data, signed.adminId), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** GET /api/internal/moderation/reviews. Read-only, across stores. */
export async function reviewModerationList(request: NextRequest): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;
    const parsed = reviewModerationListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ errors: [{ message: 'Check the filters and try again.', code: 'INVALID_REQUEST' }] }, { status: 422, headers: NO_STORE });
    }
    await requireDatabase();
    return NextResponse.json(await listModerationReviews(parsed.data), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
