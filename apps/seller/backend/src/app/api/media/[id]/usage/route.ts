import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError } from '@/lib/http';
import { findMediaUsage } from '@/lib/media-usage';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Media } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/media/:id/usage (Sprint 7, S7-B1, CO-10): where one file of the verified store is used, from the media registry (lib/media-usage.ts).
 *
 *   200 { mediaId, inUse, total, features: [{ key, label, count, items: [{ id, title }] }] }   items are the first 20 of each feature
 *   401   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's (its usage is never read)
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can see where its media is used');
    assertCan(ctx.actor, 'read', 'media');
    const { id } = await context.params;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Media not found');
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const row = await Media.findOne({ _id: id, store: storeId }).select('_id').lean();
    if (!row) throw new HttpError(404, 'Media not found');

    return NextResponse.json(await findMediaUsage(storeId, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
