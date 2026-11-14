import { deleteAsset } from '@/lib/cloudinary';
import { Media, Product, Store } from '@/lib/services';

/**
 * Sprint 4 EP-04.US01.T03 (CO-09, CO-12): where a Media record is still used, and how a record that is no longer used is
 * removed. Shared by the logo/banner replace routes and DELETE /api/media/:id.
 */

/** What uses this media in its store: products (gallery, videos, variant images, SEO image) and the store's branding. */
export async function mediaUsage(storeId: string, mediaId: string): Promise<{ products: number; branding: string[] }> {
  const products = await Product.countDocuments({
    store: storeId,
    $or: [{ media: mediaId }, { videos: mediaId }, { 'variants.imageId': mediaId }, { seoImage: mediaId }],
  });
  const store = (await Store.findOne({ _id: storeId }).select('storefront').lean()) as { storefront?: Record<string, unknown> } | null;
  const sf = store?.storefront ?? {};
  const branding = (['logo', 'banner', 'seoImage'] as const).filter((key) => sf[key] !== undefined && sf[key] !== null && String(sf[key]) === mediaId);
  return { products, branding };
}

/**
 * Removes a media record and its Cloudinary file, best effort: the seller's change already happened, so a failure is
 * logged and never answered. A record still in use is left alone.
 */
export async function removeMediaIfUnused(storeId: string, mediaId: string | null): Promise<void> {
  if (!mediaId || !/^[0-9a-fA-F]{24}$/.test(mediaId)) return;
  try {
    const usage = await mediaUsage(storeId, mediaId);
    if (usage.products > 0 || usage.branding.length > 0) return;
    const row = (await Media.findOneAndDelete({ _id: mediaId, store: storeId }).lean()) as { cloudinaryPublicId?: unknown; resourceType?: unknown } | null;
    if (row && typeof row.cloudinaryPublicId === 'string' && row.cloudinaryPublicId !== '') {
      await deleteAsset(row.cloudinaryPublicId, row.resourceType === 'video' ? 'video' : 'image');
    }
  } catch (err) {
    console.error('[seller-backend] could not remove an unused media record', { mediaId, error: err instanceof Error ? err.message : 'unknown' });
  }
}
