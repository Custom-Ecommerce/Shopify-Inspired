import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { objectIdSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, StoreArticle } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/storeArticles/:id. Another store's article answers 404. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'storeArticles');
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const doc = await StoreArticle.findOne({ _id: id, store: storeId }).lean();
    if (!doc) throw new HttpError(404, 'Article not found');
    return NextResponse.json(toWire(plainDoc(doc)));
  } catch (err) {
    return handleRouteError(err);
  }
}
