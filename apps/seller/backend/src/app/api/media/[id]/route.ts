import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { deleteAsset } from '@/lib/cloudinary';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError } from '@/lib/http';
import { mediaUsage } from '@/lib/media-cleanup';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Media, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/media/:id (Sprint 4, CO-09). Deletes one Media record of the verified store and its Cloudinary file.
 *
 *   200 { deleted: true }   401   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's
 *   409 MEDIA_IN_USE { products, branding }   the media is still used by a product or as the store's logo, banner or
 *       share image: nothing is deleted
 *
 * The Cloudinary delete is best effort (a failure is logged): the record is gone either way.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can delete its media');
    assertCan(ctx.actor, 'delete', 'media');
    const { id } = await context.params;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Media not found');
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const row = (await Media.findOne({ _id: id, store: storeId }).select('cloudinaryPublicId resourceType').lean()) as {
      cloudinaryPublicId?: unknown;
      resourceType?: unknown;
    } | null;
    if (!row) throw new HttpError(404, 'Media not found');

    const usage = await mediaUsage(storeId, id);
    if (usage.products > 0 || usage.branding.length > 0) {
      return NextResponse.json(
        { errors: [{ message: 'This file is still in use. Remove it from the products or the store settings first.' }], code: 'MEDIA_IN_USE', ...usage },
        { status: 409 },
      );
    }

    const deleted = await Media.findOneAndDelete({ _id: id, store: storeId }).lean();
    if (!deleted) throw new HttpError(404, 'Media not found');
    if (typeof row.cloudinaryPublicId === 'string' && row.cloudinaryPublicId !== '') {
      await deleteAsset(row.cloudinaryPublicId, row.resourceType === 'video' ? 'video' : 'image');
    }
    try {
      await writeAuditLog('media.delete', 'media', id, 'seller:' + ctx.userId, { storeId, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the media delete audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
