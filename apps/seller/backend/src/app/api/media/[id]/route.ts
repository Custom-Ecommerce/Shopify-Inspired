import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { deleteAsset } from '@/lib/cloudinary';
import { mediaRenameRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { mediaUsage } from '@/lib/media-cleanup';
import { connectSellerDb } from '@/lib/mongo';
import { plainDoc, toWire } from '@/lib/seller-scope';
import { assertCan, Media, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const notFound = (): HttpError => new HttpError(404, 'Media not found');
const RENAME_INVALID = 'MEDIA_RENAME_INVALID';

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** The body of a rename: JSON, with a name and nothing else. A 400 names the field (the form marks it); another key (the url, the store ...) is refused, never ignored. */
async function parseRename(request: NextRequest): Promise<{ name: string } | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Body must be JSON', RENAME_INVALID, 'name');
  }
  const parsed = mediaRenameRequestSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  if (issue?.code === 'unrecognized_keys') return jsonError(400, 'Only the name of a file can be changed.', RENAME_INVALID, String(issue.keys[0] ?? 'name'));
  return jsonError(400, issue?.message ?? 'Enter a name.', RENAME_INVALID, String(issue?.path[0] ?? 'name'));
}

/**
 * PATCH /api/media/:id (Sprint 7, S7-B1): renames one Media record of the verified store. Only the name changes; the url, the alt text and the
 * Cloudinary file stay as they are.
 *
 *   200 the record   400 MEDIA_RENAME_INVALID { field }   401   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's
 *
 * Order: authenticate, role, parse, assertCan, DB, id, store, findOne({ _id, store }), ONE write, re-read, best-effort audit.
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can rename its media');
    const body = await parseRename(request);
    if (body instanceof NextResponse) return body;
    assertCan(ctx.actor, 'update', 'media', Object.keys(body));
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const before = (await Media.findOne({ _id: id, store: storeId }).select('name alt').lean()) as { name?: unknown } | null;
    if (!before) throw notFound();

    const written = (await Media.updateOne({ _id: id, store: storeId }, { $set: { name: body.name } })) as { matchedCount?: number; n?: number };
    if ((written.matchedCount ?? written.n ?? 0) === 0) throw notFound();

    const after = await Media.findOne({ _id: id, store: storeId }).lean();
    if (!after) throw notFound();
    try {
      await writeAuditLog('media.rename', 'media', id, 'seller:' + ctx.userId, {
        storeId,
        fields: ['name'],
        from: typeof before.name === 'string' ? before.name : null,
        to: body.name,
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[seller-backend] could not write the media rename audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json(toWire(plainDoc(after)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * DELETE /api/media/:id (Sprint 4, CO-09). Deletes one Media record of the verified store and its Cloudinary file.
 *
 *   200 { deleted: true }   401   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's
 *   409 MEDIA_IN_USE { mediaId, inUse, total, features, products, branding }   the media is still used by something that registered with the media
 *       registry (a product, the store's logo, banner or share image; later articles, pages, theme config): nothing is deleted. `features` is the same
 *       list GET /api/media/:id/usage answers; `products` and `branding` are the Sprint 4 fields.
 *
 * The Cloudinary delete is best effort (a failure is logged): the record is gone either way.
 */
export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can delete its media');
    assertCan(ctx.actor, 'delete', 'media');
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const row = (await Media.findOne({ _id: id, store: storeId }).select('cloudinaryPublicId resourceType').lean()) as {
      cloudinaryPublicId?: unknown;
      resourceType?: unknown;
    } | null;
    if (!row) throw notFound();

    const usage = await mediaUsage(storeId, id);
    if (usage.inUse) {
      return NextResponse.json(
        {
          errors: [{ message: 'This file is still in use. Remove it from the places listed first.' }],
          code: 'MEDIA_IN_USE',
          ...usage.usage,
          products: usage.products,
          branding: usage.branding,
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const deleted = await Media.findOneAndDelete({ _id: id, store: storeId }).lean();
    if (!deleted) throw notFound();
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
