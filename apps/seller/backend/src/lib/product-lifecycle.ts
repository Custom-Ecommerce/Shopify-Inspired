import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { objectIdSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { ProductRequestError, handleProductError, loadSellerProduct, productNotFound } from '@/lib/products';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan, Product } from '@/lib/services';

export type ProductRouteContext = { params: Promise<{ id: string }> };

export const adminDeleted = (): ProductRequestError =>
  new ProductRequestError(403, 'PRODUCT_ADMIN_DELETED', 'An admin removed this product, so it cannot be restored or deleted here.');

/** The reason travels in the body, so the seller sees why. Who took it down does not. */
export const takenDown = (reason: string): ProductRequestError =>
  new ProductRequestError(403, 'PRODUCT_TAKEN_DOWN', 'An admin removed this product: ' + reason, { reason });

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

export interface PublishableProduct {
  title?: string | null;
  isDemo?: boolean | null;
  categories?: unknown[] | null;
  variants?: Array<{ price?: number | null }> | null;
  moderation?: { reason: string } | null;
}

/** Why a product cannot go Live, or null. A variant at 0 has not been priced yet, so it does not count. */
export function publishProblem(row: PublishableProduct): ProductRequestError | null {
  if (row.moderation) return takenDown(row.moderation.reason);
  if (row.isDemo === true) {
    return new ProductRequestError(422, 'PRODUCT_DEMO_NOT_EDITED', 'This is the sample product. Edit it first, then publish it.');
  }
  if (!row.title || row.title.trim() === '') return new ProductRequestError(422, 'PRODUCT_TITLE_REQUIRED', 'Add a title before publishing.');
  if ((row.categories ?? []).length === 0) {
    return new ProductRequestError(422, 'PRODUCT_CATEGORY_REQUIRED', 'Choose a category before publishing.');
  }
  if (!(row.variants ?? []).some((variant) => typeof variant.price === 'number' && variant.price > 0)) {
    return new ProductRequestError(422, 'PRODUCT_PRICE_REQUIRED', 'Set a price before publishing.');
  }
  return null;
}

/**
 * POST /api/products/:id/publish and /unpublish. A trashed product, or another store's, answers 404. Publishing checks
 * the rules on a read, then writes with the demo and trash conditions in the filter, so a delete that lands in between
 * is not undone, and a takedown that lands in between holds too. Unpublishing has no rules. Both tell the storefront to
 * drop its cache.
 */
export async function changePublished(request: NextRequest, context: ProductRouteContext, published: boolean): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'productLifecycle', ['isPublished']);
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    if (published) {
      const row = (await Product.findOne({ _id: id, store: storeId, deletedAt: null })
        .select('title isDemo categories variants.price moderation')
        .lean()) as unknown as PublishableProduct | null;
      if (!row) throw productNotFound();
      const problem = publishProblem(row);
      if (problem) throw problem;
    }

    const updated = await Product.findOneAndUpdate(
      { _id: id, store: storeId, deletedAt: null, ...(published ? { isDemo: { $ne: true }, moderation: null } : {}) },
      { $set: { isPublished: published } },
      { new: true },
    )
      .select('_id')
      .lean();
    if (!updated) throw productNotFound();

    revalidateStoreProduct(storeId, id);
    return NextResponse.json(await loadSellerProduct(storeId, id));
  } catch (err) {
    return handleProductError(err);
  }
}

interface TrashState {
  deletedAt?: Date | null;
  deletedBy?: { role?: string | null } | null;
}

/**
 * POST /api/products/:id/restore. The product comes back as a draft, whatever it was before. What an admin deleted stays
 * deleted (403 PRODUCT_ADMIN_DELETED), and the same condition sits in the write's filter.
 */
export async function restoreProduct(request: NextRequest, context: ProductRouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'productLifecycle', ['deletedAt']);
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const row = (await Product.findOne({ _id: id, store: storeId }).select('deletedAt deletedBy').lean()) as unknown as TrashState | null;
    if (!row) throw productNotFound();
    if (!row.deletedAt) throw new ProductRequestError(409, 'PRODUCT_NOT_IN_TRASH', 'This product is not in trash.');
    if (row.deletedBy?.role === 'admin') throw adminDeleted();

    const restored = await Product.findOneAndUpdate(
      { _id: id, store: storeId, deletedAt: { $ne: null }, 'deletedBy.role': { $ne: 'admin' } },
      { $set: { deletedAt: null, deletedBy: null, isPublished: false } },
      { new: true },
    )
      .select('_id')
      .lean();
    if (!restored) throw productNotFound();

    revalidateStoreProduct(storeId, id);
    return NextResponse.json(await loadSellerProduct(storeId, id));
  } catch (err) {
    return handleProductError(err);
  }
}
