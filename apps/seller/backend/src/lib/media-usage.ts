import { Product, Store, StoreArticle, StorePage } from '@/lib/services';

/**
 * Sprint 7 (S7-B1, CO-10): the ONE place that knows where a media file is used. Every feature that can hold a Media id registers here, so the
 * delete route, the "where is this used" answer, the unused-file cleanup and the orphan sweep can never miss a user of the file.
 *
 * Registered today: products (gallery, videos, variant images, SEO image) and the store's branding (logo, banner, share image).
 * Later features (article covers, static page images, theme config images) call registerMediaFeature once, from their own lib, and need
 * no change in any route. Importing this module is what registers the built-in features, so every consumer imports it.
 */

/** Items listed per feature in an answer. The count is always the real number. */
export const MEDIA_USAGE_ITEM_CAP = 20;

export interface MediaUsageItem {
  id: string;
  title: string;
}

export interface MediaFeatureUsage {
  /** The real number of records of this feature that use the file. */
  count: number;
  /** At most MEDIA_USAGE_ITEM_CAP of them. */
  items: MediaUsageItem[];
}

export interface MediaFeature {
  /** Stable key, for example 'products'. Registering the same key again replaces the earlier entry. */
  key: string;
  /** Shown to the seller, for example 'Products'. */
  label: string;
  /** Where the file is used in this feature, for this store. Must filter by store. */
  find(storeId: string, mediaId: string): Promise<MediaFeatureUsage>;
}

export interface MediaUsageFeatureResult {
  key: string;
  label: string;
  count: number;
  items: MediaUsageItem[];
}

export interface MediaUsageResult {
  mediaId: string;
  inUse: boolean;
  total: number;
  features: MediaUsageFeatureResult[];
}

const registry = new Map<string, MediaFeature>();

export function registerMediaFeature(feature: MediaFeature): void {
  registry.set(feature.key, feature);
}

/** For tests: removes a feature again (a test registers a fake one and cleans up). */
export function unregisterMediaFeature(key: string): void {
  registry.delete(key);
}

export function listMediaFeatures(): MediaFeature[] {
  return [...registry.values()];
}

/** Every registered feature's answer for one file of one store. A feature that throws makes the whole answer throw: "unknown" is never read as "unused". */
export async function findMediaUsage(storeId: string, mediaId: string): Promise<MediaUsageResult> {
  const features: MediaUsageFeatureResult[] = [];
  for (const feature of listMediaFeatures()) {
    const found = await feature.find(storeId, mediaId);
    if (found.count > 0) features.push({ key: feature.key, label: feature.label, count: found.count, items: found.items.slice(0, MEDIA_USAGE_ITEM_CAP) });
  }
  const total = features.reduce((sum, feature) => sum + feature.count, 0);
  return { mediaId, inUse: total > 0, total, features };
}

export async function isMediaInUse(storeId: string, mediaId: string): Promise<boolean> {
  return (await findMediaUsage(storeId, mediaId)).inUse;
}

// ------------------------------------------------------------------------------------------------------ built-in features

const productUses = (mediaId: string): Record<string, unknown>[] => [{ media: mediaId }, { videos: mediaId }, { 'variants.imageId': mediaId }, { seoImage: mediaId }];

/** Products, trashed ones included: a file in a product in the trash is still in use until the product is purged. */
registerMediaFeature({
  key: 'products',
  label: 'Products',
  async find(storeId, mediaId) {
    const filter = { store: storeId, $or: productUses(mediaId) };
    const [count, rows] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).select('title').limit(MEDIA_USAGE_ITEM_CAP).lean() as unknown as Promise<Array<{ _id: unknown; title?: unknown }>>,
    ]);
    return { count, items: rows.map((row) => ({ id: String(row._id), title: typeof row.title === 'string' ? row.title : '' })) };
  },
});

const BRANDING_LABELS = { logo: 'Store logo', banner: 'Store banner', seoImage: 'Store share image' } as const;

/** The store's own logo, banner and share image (the store settings). */
registerMediaFeature({
  key: 'branding',
  label: 'Store settings',
  async find(storeId, mediaId) {
    const store = (await Store.findOne({ _id: storeId }).select('storefront').lean()) as { storefront?: Record<string, unknown> } | null;
    const sf = store?.storefront ?? {};
    const items = (Object.keys(BRANDING_LABELS) as Array<keyof typeof BRANDING_LABELS>)
      .filter((key) => sf[key] !== undefined && sf[key] !== null && String(sf[key]) === mediaId)
      .map((key) => ({ id: key, title: BRANDING_LABELS[key] }));
    return { count: items.length, items };
  },
});

/**
 * Sprint 7 (S7-B2): blog articles. An article uses a file as its cover and through the images in its text; the server keeps both in the article's
 * `mediaRefs` every time the cover or the text is written, so one indexed question answers it. A used image can never be deleted.
 */
registerMediaFeature({
  key: 'articles',
  label: 'Blog articles',
  async find(storeId, mediaId) {
    const filter = { store: storeId, mediaRefs: mediaId };
    const [count, rows] = await Promise.all([
      StoreArticle.countDocuments(filter),
      StoreArticle.find(filter).select('title').limit(MEDIA_USAGE_ITEM_CAP).lean() as unknown as Promise<Array<{ _id: unknown; title?: unknown }>>,
    ]);
    return { count, items: rows.map((row) => ({ id: String(row._id), title: typeof row.title === 'string' ? row.title : '' })) };
  },
});

/**
 * Sprint 7 (S7-B3): static pages. A page uses a file through the images in its text; the server keeps them in the page's `mediaRefs` every time the body is
 * written, so one indexed question answers it. A used image can never be deleted.
 */
registerMediaFeature({
  key: 'pages',
  label: 'Pages',
  async find(storeId, mediaId) {
    const filter = { store: storeId, mediaRefs: mediaId };
    const [count, rows] = await Promise.all([
      StorePage.countDocuments(filter),
      StorePage.find(filter).select('title').limit(MEDIA_USAGE_ITEM_CAP).lean() as unknown as Promise<Array<{ _id: unknown; title?: unknown }>>,
    ]);
    return { count, items: rows.map((row) => ({ id: String(row._id), title: typeof row.title === 'string' ? row.title : '' })) };
  },
});
