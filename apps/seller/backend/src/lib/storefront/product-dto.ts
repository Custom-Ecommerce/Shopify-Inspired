import { storefrontProductDetailSchema, storefrontProductSummarySchema } from '@/lib/contracts';

interface PopulatedCategory {
  _id: unknown;
  slug?: string | null;
  name?: string | null;
}

interface PopulatedMedia {
  url?: string | null;
  alt?: string | null;
}

/** A product as .lean() returns it after populating categories and the first media entry. */
export interface ProductRow {
  _id: unknown;
  slug: string;
  title: string;
  price: number;
  originalPrice?: number | null;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  categories?: Array<PopulatedCategory | null> | null;
  media?: Array<PopulatedMedia | null> | null;
  avgRating?: number | null;
  reviewCount?: number | null;
}

/**
 * Projects one product to StorefrontProductSummary. A category that was deleted (populates to null) or
 * has no slug is dropped; a missing or unpopulated first media entry means no primary image.
 */
export function toProductSummaryDto(row: ProductRow) {
  const first = row.media?.[0] ?? null;
  const url = first && typeof first.url === 'string' && first.url !== '' ? first.url : null;

  return {
    id: String(row._id),
    slug: row.slug,
    title: row.title,
    currency: 'PKR' as const,
    price: row.price,
    originalPrice: row.originalPrice ?? null,
    stockStatus: row.stockStatus,
    primaryImage: url ? { url, alt: first?.alt || row.title } : null,
    categories: (row.categories ?? [])
      .filter((c): c is PopulatedCategory => !!c && typeof c.slug === 'string' && c.slug !== '')
      .map((c) => ({ id: String(c._id), slug: c.slug as string, name: c.name ?? c.slug ?? '' })),
    avgRating: row.avgRating ?? 0,
    reviewCount: row.reviewCount ?? 0,
  };
}

/** Validates the projection against the contract, so a malformed row fails closed instead of reaching a theme. */
export function toValidatedProductSummaries(rows: ProductRow[]) {
  return rows.map((row) => storefrontProductSummarySchema.parse(toProductSummaryDto(row)));
}

interface DetailMedia extends PopulatedMedia {
  _id?: unknown;
}

/** A product as .lean() returns it for the detail page: every media entry and the SEO image populated. */
export interface ProductDetailRow extends Omit<ProductRow, 'media'> {
  media?: Array<DetailMedia | null> | null;
  description?: string | null;
  highlights?: Array<{ text?: string | null } | null> | null;
  tags?: Array<string | null> | null;
  deliveryCharge?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoImage?: PopulatedMedia | null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Projects one product to StorefrontProductDetail. It never carries stock counts, the store id, or any
 * seller-side field: only what the page shows. deliveryCharge falls back to the store's default rate when
 * the product has no charge of its own, so the page and the order total agree.
 */
export function toProductDetailDto(row: ProductDetailRow, storeDeliveryRate: number) {
  const images = (row.media ?? [])
    .map((m) => ({ url: nonEmpty(m?.url), alt: m?.alt || row.title }))
    .filter((m): m is { url: string; alt: string } => m.url !== null);

  const summary = toProductSummaryDto({ ...row, media: images.length > 0 ? [images[0]] : [] });
  const categorySlugs = summary.categories.map((c) => c.slug);

  return {
    ...summary,
    primaryImage: images[0] ?? null,
    description: nonEmpty(row.description),
    highlights: (row.highlights ?? []).map((h) => nonEmpty(h?.text)).filter((t): t is string => t !== null),
    images,
    seo: {
      title: nonEmpty(row.seoTitle),
      description: nonEmpty(row.seoDescription),
      imageUrl: nonEmpty(row.seoImage?.url),
    },
    tags: (row.tags ?? []).map((t) => nonEmpty(t)).filter((t): t is string => t !== null),
    categorySlugs,
    deliveryCharge:
      typeof row.deliveryCharge === 'number' && Number.isFinite(row.deliveryCharge) && row.deliveryCharge >= 0
        ? row.deliveryCharge
        : storeDeliveryRate,
  };
}

/** Validates the projection against the contract, so a malformed row fails closed instead of reaching a theme. */
export function toValidatedProductDetail(row: ProductDetailRow, storeDeliveryRate: number) {
  return storefrontProductDetailSchema.parse(toProductDetailDto(row, storeDeliveryRate));
}
