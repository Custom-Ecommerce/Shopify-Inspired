import { deleteAsset } from '@/lib/cloudinary';
import { findMediaUsage } from '@/lib/media-usage';
import { Media } from '@/lib/services';

/**
 * Sprint 4 EP-04.US01.T03 (CO-09, CO-12): where a Media record is still used, and how a record that is no longer used is
 * removed. Shared by the logo/banner replace routes and DELETE /api/media/:id.
 * Sprint 7 (S7-B1): the answer comes from the media registry (lib/media-usage.ts), so a feature added later is counted without touching this file.
 */

/**
 * What uses this media in its store. `products` and `branding` keep their Sprint 4 shape (a count and the branding keys); `usage` is the
 * full registry answer (every feature, with titles) that the usage route and the 409 body send.
 */
export async function mediaUsage(
  storeId: string,
  mediaId: string,
): Promise<{ products: number; branding: string[]; inUse: boolean; usage: Awaited<ReturnType<typeof findMediaUsage>> }> {
  const usage = await findMediaUsage(storeId, mediaId);
  const products = usage.features.find((feature) => feature.key === 'products')?.count ?? 0;
  const branding = usage.features.find((feature) => feature.key === 'branding')?.items.map((item) => item.id) ?? [];
  return { products, branding, inUse: usage.inUse, usage };
}

/**
 * Removes a media record and its Cloudinary file, best effort: the seller's change already happened, so a failure is
 * logged and never answered. A record still in use (by ANY registered feature) is left alone.
 */
export async function removeMediaIfUnused(storeId: string, mediaId: string | null): Promise<void> {
  if (!mediaId || !/^[0-9a-fA-F]{24}$/.test(mediaId)) return;
  try {
    const usage = await mediaUsage(storeId, mediaId);
    if (usage.inUse) return;
    const row = (await Media.findOneAndDelete({ _id: mediaId, store: storeId }).lean()) as { cloudinaryPublicId?: unknown; resourceType?: unknown } | null;
    if (row && typeof row.cloudinaryPublicId === 'string' && row.cloudinaryPublicId !== '') {
      await deleteAsset(row.cloudinaryPublicId, row.resourceType === 'video' ? 'video' : 'image');
    }
  } catch (err) {
    console.error('[seller-backend] could not remove an unused media record', { mediaId, error: err instanceof Error ? err.message : 'unknown' });
  }
}
