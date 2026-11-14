import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { deleteAsset, uploadImage } from '@/lib/cloudinary';
import { HttpError, handleRouteError } from '@/lib/http';
import { removeMediaIfUnused } from '@/lib/media-cleanup';
import { loadOwnedStore, requireSellerActor, SETTINGS_SELECT } from '@/lib/owned-store';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, Media, Store, writeAuditLog } from '@/lib/services';
import { record, SETTINGS_ERROR_CODE, toStoreSettings } from '@/lib/store-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** A logo is small; a banner is a wide photo. */
const MAX_BYTES: Record<'logo' | 'banner', number> = { logo: 2 * 1024 * 1024, banner: 5 * 1024 * 1024 };

/**
 * POST /api/stores/:id/branding/logo | /banner (Sprint 4 EP-04.US01.T03, CO-12). multipart/form-data with one "file".
 * Uploads the image (Cloudinary, JPEG/PNG/WebP, logo up to 2 MB, banner up to 5 MB), records it as the store's Media,
 * sets it as the logo or banner in ONE compare-and-set, then removes the image it replaced (best effort, only when
 * nothing else uses it). A save calls revalidateStore().
 *
 *   201 { settings }   400 no file   401   403 admin or another seller's store   404 unknown kind or store
 *   409 the settings changed meanwhile (the new upload is removed again)   413 too large   415 not an image   503
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; kind: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const { id, kind } = await context.params;
    if (kind !== 'logo' && kind !== 'banner') throw new HttpError(404, 'Not found');

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'Send the image as multipart/form-data with a "file" field', SETTINGS_ERROR_CODE, 'file');
    }
    const file = form.get('file');
    if (!(file instanceof Blob) || file.size === 0) throw new HttpError(400, 'Choose an image to upload', SETTINGS_ERROR_CODE, 'file');
    if (!ALLOWED_TYPES.includes(file.type)) throw new HttpError(415, 'Use a JPEG, PNG or WebP image', SETTINGS_ERROR_CODE, 'file');
    if (file.size > MAX_BYTES[kind]) throw new HttpError(413, 'The ' + kind + ' can be at most ' + MAX_BYTES[kind] / (1024 * 1024) + ' MB', SETTINGS_ERROR_CODE, 'file');

    assertCan(ctx.actor, 'create', 'media', ['alt']);
    assertCan(ctx.actor, 'update', 'stores', ['storefront']);
    const current = await loadOwnedStore(request, ctx, id, SETTINGS_SELECT);
    const storeId = String(current._id);
    const previous = record(current.storefront)[kind];

    const uploaded = await uploadImage(file);
    let mediaId: string;
    try {
      const created = (await Media.create({
        store: storeId,
        alt: String(current.name ?? 'Store') + ' ' + kind,
        url: uploaded.url,
        cloudinaryPublicId: uploaded.publicId,
        cloudinaryResourceType: uploaded.resourceType,
        mimeType: file.type,
        filesize: file.size,
        width: uploaded.width,
        height: uploaded.height,
      })) as unknown as { _id: unknown };
      mediaId = String(created._id);
    } catch (err) {
      await deleteAsset(uploaded.publicId, 'image');
      throw err;
    }

    const storefront = { ...record(current.storefront), [kind]: mediaId };
    const updated = await Store.findOneAndUpdate(
      { _id: storeId, owner: ctx.userObjectId, updatedAt: current.updatedAt ?? null },
      { $set: { storefront } },
      { new: true },
    )
      .select(SETTINGS_SELECT)
      .lean();
    if (!updated) {
      await removeMediaIfUnused(storeId, mediaId);
      throw new HttpError(409, 'The settings were changed in another tab. Reload and try again.');
    }

    revalidateStore(storeId);
    await removeMediaIfUnused(storeId, previous === undefined || previous === null ? null : String(previous));
    try {
      await writeAuditLog('store.branding', 'store', storeId, 'seller:' + ctx.userId, { kind, mediaId, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the branding audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json({ settings: await toStoreSettings(updated as never) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
