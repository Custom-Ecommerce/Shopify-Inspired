import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { discountDatesProblem, discountValueProblem, objectIdSchema, updateDiscountSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Discount } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { plainDoc, toWire } from '@/lib/seller-scope';

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
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const doc = await Discount.findOne({ _id: id, store: storeId }).lean();
    if (!doc) throw new HttpError(404, 'Discount not found');
    return NextResponse.json(toWire(plainDoc(doc)));
  } catch (err) {
    return handleRouteError(err);
  }
}

interface StoredDiscount {
  type: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  archivedAt?: Date | null;
}

/**
 * PATCH /api/discounts/:id. Changes value, minimum, dates, maxUses or isActive, and archives or restores with { archived }.
 * Another store's discount answers 404. Past orders are unaffected: each keeps its own snapshot of the rule.
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    const body = await parseBody(request, updateDiscountSchema);
    if (!body.ok) return body.response;
    const { archived, ...fields } = body.data;
    assertCan(ctx.actor, 'update', 'discounts', [...Object.keys(fields), ...(archived === undefined ? [] : ['archivedAt'])]);
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const existing = (await Discount.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredDiscount | null;
    if (!existing) throw new HttpError(404, 'Discount not found');

    if (fields.value !== undefined) {
      const problem = discountValueProblem(existing.type, fields.value);
      if (problem !== null) return jsonError(422, problem);
    }
    const startDate = fields.startDate === undefined ? existing.startDate : fields.startDate;
    const endDate = fields.endDate === undefined ? existing.endDate : fields.endDate;
    const datesProblem = discountDatesProblem(startDate, endDate);
    if (datesProblem !== null) return jsonError(422, datesProblem);

    const set: Record<string, unknown> = { ...fields };
    if (archived !== undefined) set.archivedAt = archived ? (existing.archivedAt ?? new Date()) : null;

    const updated = await Discount.findOneAndUpdate({ _id: id, store: storeId }, { $set: set }, { new: true }).lean();
    if (!updated) throw new HttpError(404, 'Discount not found');
    return NextResponse.json(toWire(plainDoc(updated)));
  } catch (err) {
    return handleRouteError(err);
  }
}
