import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { objectIdSchema, productUpdateRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { parseBody } from '@/lib/placeholder';
import { adminDeleted, takenDown } from '@/lib/product-lifecycle';
import {
  ProductRequestError,
  applyProductUpdate,
  handleProductError,
  loadSellerProduct,
  prepareProductUpdate,
  productNotFound,
  type VariantRow,
} from '@/lib/products';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan, Product } from '@/lib/services';
import { purgeProduct, type PurgeableProduct } from '@/lib/trash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/products/:id. Another store's product answers 404, never its contents. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'products');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    return NextResponse.json(await loadSellerProduct(storeId, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleProductError(err);
  }
}

/**
 * PATCH /api/products/:id. Changes only the fields sent, in one atomic write, and makes a demo product the seller's own.
 * A new title keeps the slug (D-009). Refusals are those of POST, plus:
 *
 *   422 STOCK_VIA_INVENTORY  a changed stockQuantity on an existing variant (D-034). A new variant carries its own.
 *   409 PRODUCT_CHANGED      a variant named here was removed by another edit in the meantime
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    const body = await parseBody(request, productUpdateRequestSchema);
    if (!body.ok) return body.response;
    const data = body.data;
    assertCan(ctx.actor, 'update', 'products', Object.keys(data));
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const current = (await Product.findOne({ _id: id, store: storeId, deletedAt: null }).select('options variants media').lean()) as unknown as {
      options?: Array<{ name: string; values: string[] }> | null;
      variants: VariantRow[];
      media?: unknown[] | null;
    } | null;
    if (!current) throw productNotFound();

    await applyProductUpdate(storeId, id, data, await prepareProductUpdate(storeId, id, data, current));

    await revalidateStoreProduct(storeId, id);
    return NextResponse.json(await loadSellerProduct(storeId, id));
  } catch (err) {
    return handleProductError(err);
  }
}

interface DeletableRow extends PurgeableProduct {
  isDemo?: boolean;
  deletedAt?: Date | null;
  deletedBy?: { role?: string | null } | null;
  moderation?: { reason: string } | null;
}

/**
 * DELETE /api/products/:id moves a product to trash and takes it off the storefront (D-001). A demo product skips trash:
 * it goes at once and for good (D-016, A-008). Another store's product answers 404, as does one already in trash.
 *
 * DELETE /api/products/:id?permanent=true removes a trashed product for good, archiving its reviews (D-014).
 *   409 PRODUCT_NOT_IN_TRASH   it has to go to trash first
 *   403 PRODUCT_ADMIN_DELETED  an admin removed it, so what happens to it next is not the seller's call
 *   403 PRODUCT_TAKEN_DOWN     a taken-down product can go to trash, but not be destroyed: the record stays (D-040)
 */
export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    const permanent = request.nextUrl.searchParams.get('permanent') === 'true';
    assertCan(ctx.actor, 'delete', permanent ? 'productLifecycle' : 'products');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const existing = (await Product.findOne({ _id: id, store: storeId })
      .select('store title slug isDemo deletedAt deletedBy moderation')
      .lean()) as unknown as DeletableRow | null;
    if (!existing) throw productNotFound();

    if (existing.moderation && (permanent || existing.isDemo === true)) throw takenDown(existing.moderation.reason);

    if (existing.isDemo === true) {
      await Product.deleteOne({ _id: id, store: storeId, isDemo: true });
    } else if (permanent) {
      if (!existing.deletedAt) throw new ProductRequestError(409, 'PRODUCT_NOT_IN_TRASH', 'Move this product to trash first.');
      if (existing.deletedBy?.role === 'admin') throw adminDeleted();
      if (!(await purgeProduct(existing, new Date()))) throw productNotFound();
    } else {
      const trashed = await Product.findOneAndUpdate(
        { _id: id, store: storeId, deletedAt: null },
        { $set: { deletedAt: new Date(), deletedBy: { user: ctx.userObjectId, role: ctx.actor === 'admin' ? 'admin' : 'seller' }, isPublished: false } },
        { new: true },
      )
        .select('_id')
        .lean();
      if (!trashed) throw productNotFound();
      await revalidateStoreProduct(storeId, id);
      return NextResponse.json({ trashed: true, id });
    }

    await revalidateStoreProduct(storeId, id);
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return handleProductError(err);
  }
}
