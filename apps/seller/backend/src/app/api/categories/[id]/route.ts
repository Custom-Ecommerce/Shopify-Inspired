import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { categoryError, countProductsInCategory, resolveCategoryStoreId, slugTaken } from '@/lib/categories';
import { categoryUpdateRequestSchema, objectIdSchema } from '@/lib/contracts';
import { HttpError, handleRouteError, isDuplicateKeyError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { parseBody } from '@/lib/placeholder';
import { assertCan, Category } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

const categoryNotFound = (): HttpError => new HttpError(404, 'Category not found');

/** GET /api/categories/:id. Another store's category answers 404, never its contents. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'categories');
    await requireDatabase();
    const storeId = await resolveCategoryStoreId(request, ctx);

    const doc = await Category.findOne({ _id: id, store: storeId }).lean();
    if (!doc) throw categoryNotFound();
    return NextResponse.json(toWire(plainDoc(doc)));
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/categories/:id. Changes only the fields sent. A new name keeps the slug; a clashing slug is a 409. */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    const body = await parseBody(request, categoryUpdateRequestSchema);
    if (!body.ok) return body.response;
    assertCan(ctx.actor, 'update', 'categories', Object.keys(body.data));
    await requireDatabase();
    const storeId = await resolveCategoryStoreId(request, ctx);

    try {
      const updated = await Category.findOneAndUpdate(
        { _id: id, store: storeId },
        { $set: body.data },
        { new: true, runValidators: true },
      ).lean();
      if (!updated) throw categoryNotFound();
      return NextResponse.json(toWire(plainDoc(updated)));
    } catch (err) {
      if (isDuplicateKeyError(err)) return slugTaken();
      throw err;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * DELETE /api/categories/:id. A category that still holds products is refused with 409 CATEGORY_IN_USE and the count,
 * so the dashboard can say why. The demo category's rules arrive in PB-3; here it is an ordinary category.
 */
export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'delete', 'categories');
    await requireDatabase();
    const storeId = await resolveCategoryStoreId(request, ctx);

    const existing = await Category.findOne({ _id: id, store: storeId }).select('_id').lean();
    if (!existing) throw categoryNotFound();

    const productCount = await countProductsInCategory(storeId, id);
    if (productCount > 0) {
      const noun = productCount === 1 ? '1 product' : productCount + ' products';
      return categoryError(409, 'CATEGORY_IN_USE', 'This category still holds ' + noun + '. Move or delete them first.', {
        productCount,
      });
    }

    await Category.deleteOne({ _id: id, store: storeId });
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return handleRouteError(err);
  }
}
