import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { objectIdSchema, returnStatusUpdateSchema, RETURN_TRANSITIONS } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Return } from '@/lib/services';
import { plainDoc, requireSellerStoreId, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/returns/:id. Another store's return answers 404. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'returns');
    await requireDatabase();
    const storeId = await requireSellerStoreId(ctx);

    const doc = await Return.findOne({ _id: id, store: storeId }).lean();
    if (!doc) throw new HttpError(404, 'Return not found');
    return NextResponse.json(toWire(plainDoc(doc)));
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/returns/:id. Changes status, refundType, or refundAmount only. A status move that the transition
 * table does not allow is refused with 409, and the return is left as it was.
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    const body = await parseBody(request, returnStatusUpdateSchema);
    if (!body.ok) return body.response;
    assertCan(ctx.actor, 'update', 'returns', Object.keys(body.data));
    await requireDatabase();
    const storeId = await requireSellerStoreId(ctx);

    const current = await Return.findOne({ _id: id, store: storeId }).lean();
    if (!current) throw new HttpError(404, 'Return not found');

    const from = String((current as unknown as { status: string }).status);
    const to = body.data.status;
    if (to !== undefined && to !== from) {
      const allowed = (RETURN_TRANSITIONS as Record<string, string[]>)[from] ?? [];
      if (!allowed.includes(to)) {
        throw new HttpError(409, 'A return cannot move from ' + from + ' to ' + to);
      }
    }

    const updated = await Return.findOneAndUpdate(
      { _id: id, store: storeId },
      { $set: body.data },
      { new: true },
    ).lean();
    if (!updated) throw new HttpError(404, 'Return not found');
    return NextResponse.json(toWire(plainDoc(updated)));
  } catch (err) {
    return handleRouteError(err);
  }
}
