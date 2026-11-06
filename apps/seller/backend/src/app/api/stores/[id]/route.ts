/* patch_orders_fix: GET /api/stores/:id (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { SELLER_STORE_READABLE_FIELDS } from '@markaz/auth';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Store } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id. A seller reads only a store they own, projected to the fields the policy lets a
 * seller read; admins read the full document. A store that is not yours is a 404 (existence is not revealed).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { id } = await context.params;

    const projection = ctx.actor === 'seller' ? [...SELLER_STORE_READABLE_FIELDS] : undefined;
    assertCan(ctx.actor, 'read', 'stores', projection);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Store not found');

    const filter = ctx.actor === 'seller' ? { _id: id, owner: ctx.userObjectId } : { _id: id };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (Store as any).findOne(filter);
    if (projection) query.select(projection.join(' '));
    const doc = await query.lean();
    if (!doc) throw new HttpError(404, 'Store not found');

    return NextResponse.json(toWire(plainDoc(doc)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
