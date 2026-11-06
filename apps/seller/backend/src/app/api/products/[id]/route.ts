import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { objectIdSchema, productUpdateRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { parseBody } from '@/lib/placeholder';
import {
  ProductRequestError,
  assertStoreCategories,
  assertStoreMedia,
  handleProductError,
  loadSellerProduct,
  preparePatchedVariants,
  productNotFound,
  productPatchFilter,
  productPatchSet,
  type VariantRow,
} from '@/lib/products';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { assertCan, Product } from '@/lib/services';

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

    const current = (await Product.findOne({ _id: id, store: storeId }).select('options variants').lean()) as unknown as {
      options?: Array<{ name: string; values: string[] }> | null;
      variants: VariantRow[];
    } | null;
    if (!current) throw productNotFound();

    if (data.categories) await assertStoreCategories(storeId, data.categories);
    await assertStoreMedia(storeId, [...(data.media ?? []), data.seoImage, ...(data.variants ?? []).map((variant) => variant.imageId)]);

    const prepared = data.variants || data.options ? await preparePatchedVariants(storeId, id, current, data) : null;

    const updated = await Product.findOneAndUpdate(productPatchFilter(storeId, id, prepared), [{ $set: productPatchSet(data, prepared) }], {
      new: true,
    })
      .select('_id')
      .lean();
    if (!updated) {
      throw new ProductRequestError(409, 'PRODUCT_CHANGED', 'This product changed while you were editing it. Reload and try again.');
    }

    await revalidateStoreProduct(storeId, id);
    return NextResponse.json(await loadSellerProduct(storeId, id));
  } catch (err) {
    return handleProductError(err);
  }
}

/**
 * DELETE /api/products/:id. A demo product goes at once and for good (D-016, A-008). Any other product answers 501
 * PRODUCT_DELETE_NOT_AVAILABLE until trash arrives. Another store's product answers 404.
 */
export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'delete', 'products');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const existing = (await Product.findOne({ _id: id, store: storeId }).select('isDemo').lean()) as { isDemo?: boolean } | null;
    if (!existing) throw productNotFound();
    if (existing.isDemo !== true) {
      throw new ProductRequestError(501, 'PRODUCT_DELETE_NOT_AVAILABLE', 'Deleting products is not available yet.');
    }

    await Product.deleteOne({ _id: id, store: storeId, isDemo: true });
    await revalidateStoreProduct(storeId, id);
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return handleProductError(err);
  }
}
