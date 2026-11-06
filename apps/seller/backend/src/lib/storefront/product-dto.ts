import { productAvailability, variantAvailability } from '@markaz/platform-kit/commerce';
import { storefrontProductDetailSchema, storefrontProductSummarySchema } from '@/lib/contracts';
import { previewLabelOf } from '@/lib/storefront/live-product';

interface PopulatedCategory {
  _id: unknown;
  slug?: string | null;
  name?: string | null;
}

interface PopulatedMedia {
  url?: string | null;
  alt?: string | null;
}

/** A variant as .lean() returns it. The list reads the priced and stocked fields; the detail reads all of them. */
interface VariantRow {
  _id: unknown;
  title?: string | null;
  price: number;
  compareAtPrice?: number | null;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold?: number | null;
  optionValues?: string[] | null;
  imageId?: unknown;
  position?: number | null;
}

/** A product as .lean() returns it after populating categories and the first media entry. */
export interface ProductRow {
  _id: unknown;
  slug: string;
  title: string;
  minPrice: number;
  variants: VariantRow[];
  categories?: Array<PopulatedCategory | null> | null;
  media?: Array<PopulatedMedia | null> | null;
  avgRating?: number | null;
  reviewCount?: number | null;
  /** Read in a preview only, for the tag. A live read does not ask for them. */
  isPublished?: boolean | null;
  isDemo?: boolean | null;
}

const byPosition = (variants: readonly VariantRow[]): VariantRow[] =>
  [...variants].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

/**
 * Projects one product to StorefrontProductSummary. The price is the from price, and the compare-at is that of the
 * cheapest variant. A category that was deleted (populates to null) or has no slug is dropped; a missing or unpopulated
 * first media entry means no primary image.
 */
export function toProductSummaryDto(row: ProductRow) {
  const first = row.media?.[0] ?? null;
  const url = first && typeof first.url === 'string' && first.url !== '' ? first.url : null;

  const variants = byPosition(row.variants);
  const cheapest = variants.find((variant) => variant.price === row.minPrice) ?? null;
  const defaultVariant = variants.find((variant) => variantAvailability(variant) !== 'out_of_stock') ?? variants[0];

  return {
    id: String(row._id),
    slug: row.slug,
    title: row.title,
    currency: 'PKR' as const,
    price: row.minPrice,
    compareAtPrice: cheapest?.compareAtPrice ?? null,
    stockStatus: productAvailability(variants.map(variantAvailability)),
    defaultVariantId: defaultVariant ? String(defaultVariant._id) : '',
    hasVariants: variants.length > 1,
    primaryImage: url ? { url, alt: first?.alt || row.title } : null,
    categories: (row.categories ?? [])
      .filter((c): c is PopulatedCategory => !!c && typeof c.slug === 'string' && c.slug !== '')
      .map((c) => ({ id: String(c._id), slug: c.slug as string, name: c.name ?? c.slug ?? '' })),
    avgRating: row.avgRating ?? 0,
    reviewCount: row.reviewCount ?? 0,
  };
}

/** The tag, in a preview only. A live response does not have the key at all. */
function previewFields(row: Pick<ProductRow, 'isPublished' | 'isDemo'>, preview: boolean) {
  return preview ? { previewLabel: previewLabelOf(row) } : {};
}

/** Validates the projection against the contract, so a malformed row fails closed instead of reaching a theme. */
export function toValidatedProductSummaries(rows: ProductRow[], preview = false) {
  return rows.map((row) => storefrontProductSummarySchema.parse({ ...toProductSummaryDto(row), ...previewFields(row, preview) }));
}

interface DetailVideo {
  _id?: unknown;
  url?: string | null;
  posterUrl?: string | null;
  duration?: number | null;
}

interface DetailMedia extends PopulatedMedia {
  _id?: unknown;
}

/** A product as .lean() returns it for the detail page: every media entry and the SEO image populated. */
export interface ProductDetailRow extends Omit<ProductRow, 'media'> {
  media?: Array<DetailMedia | null> | null;
  videos?: Array<DetailVideo | null> | null;
  options?: Array<{ name: string; values: string[] }> | null;
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
 * Projects one product to StorefrontProductDetail. It never carries stock counts, SKUs, barcodes, the store id, or
 * any seller-side field: only what the page shows. deliveryCharge falls back to the store's default rate when
 * the product has no charge of its own, so the page and the order total agree.
 */
export function toProductDetailDto(row: ProductDetailRow, storeDeliveryRate: number) {
  const images = (row.media ?? [])
    .map((m) => ({ id: String(m?._id), url: nonEmpty(m?.url), alt: m?.alt || row.title }))
    .filter((m): m is { id: string; url: string; alt: string } => m.url !== null);

  const summary = toProductSummaryDto({ ...row, media: images.length > 0 ? [images[0]] : [] });
  const categorySlugs = summary.categories.map((c) => c.slug);

  return {
    ...summary,
    options: (row.options ?? []).map((option) => ({ name: option.name, values: [...option.values] })),
    variants: byPosition(row.variants).map((variant) => ({
      id: String(variant._id),
      title: variant.title ?? '',
      price: variant.price,
      compareAtPrice: variant.compareAtPrice ?? null,
      availability: variantAvailability(variant),
      optionValues: [...(variant.optionValues ?? [])],
      imageId: variant.imageId ? String(variant.imageId) : null,
    })),
    primaryImage: images[0] ?? null,
    description: nonEmpty(row.description),
    highlights: (row.highlights ?? []).map((h) => nonEmpty(h?.text)).filter((t): t is string => t !== null),
    images,
    videos: (row.videos ?? []).flatMap((video) => {
      const url = nonEmpty(video?.url);
      return url ? [{ id: String(video?._id), url, posterUrl: nonEmpty(video?.posterUrl), duration: video?.duration ?? null }] : [];
    }),
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
export function toValidatedProductDetail(row: ProductDetailRow, storeDeliveryRate: number, preview = false) {
  return storefrontProductDetailSchema.parse({ ...toProductDetailDto(row, storeDeliveryRate), ...previewFields(row, preview) });
}
