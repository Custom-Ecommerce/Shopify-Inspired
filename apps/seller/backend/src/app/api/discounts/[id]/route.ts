import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { objectIdSchema, updateDiscountSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Discount } from '@/lib/services';
import { plainDoc, requireSellerStoreId, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/discounts/:id. Another store's discount answers 404, never its contents. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'discounts');
    await requireDatabase();
    const storeId = await requireSellerStoreId(ctx);

    const doc = await Discount.findOne({ _id: id, store: storeId }).lean();
    if (!doc) throw new HttpError(404, 'Discount not found');
    return NextResponse.json(toWire(plainDoc(doc)));
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/discounts/:id. Changes isActive, maxUses, or endDate only. */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    const body = await parseBody(request, updateDiscountSchema);
    if (!body.ok) return body.response;
    assertCan(ctx.actor, 'update', 'discounts', Object.keys(body.data));
    await requireDatabase();
    const storeId = await requireSellerStoreId(ctx);

    const updated = await Discount.findOneAndUpdate(
      { _id: id, store: storeId },
      { $set: body.data },
      { new: true },
    ).lean();
    if (!updated) throw new HttpError(404, 'Discount not found');
    return NextResponse.json(toWire(plainDoc(updated)));
  } catch (err) {
    return handleRouteError(err);
  }
}
