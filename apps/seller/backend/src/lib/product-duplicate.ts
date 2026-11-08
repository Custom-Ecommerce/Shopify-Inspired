import type { Types } from 'mongoose';
import { PRODUCT_SLUG_MAX, PRODUCT_TITLE_MAX } from '@/lib/contracts';
import { takenDown } from '@/lib/product-lifecycle';
import { isDuplicateKeyError } from '@/lib/http';
import { isSkuDuplicateError, prepareProductVariants, skuTakenFromDuplicate } from '@/lib/product-variants';
import { ProductRequestError, productNotFound, type VariantRow } from '@/lib/products';
import { Product } from '@/lib/services';

const SKU_MAX = 64;
const COPY_ATTEMPTS = 50;
const COPY_SUFFIX = ' (Copy)';
/** How many times a copy is tried when another writer takes its slug or SKU first. */
const DUPLICATE_WRITE_ATTEMPTS = 3;

interface SourceProduct {
  title: string;
  slug: string;
  isDemo?: boolean | null;
  deletedAt?: unknown;
  moderation?: { reason: string } | null;
  categories?: Types.ObjectId[] | null;
  media?: Types.ObjectId[] | null;
  videos?: Types.ObjectId[] | null;
  description?: string | null;
  highlights?: Array<{ text: string }> | null;
  tags?: string[] | null;
  options?: Array<{ name: string; values: string[] }> | null;
  variants: VariantRow[];
  deliveryCharge?: number | null;
  isFeatured?: boolean | null;
  hideWhenOutOfStock?: boolean | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoImage?: Types.ObjectId | null;
}

/** title (Copy), cut so the whole still fits. */
export function copyTitle(title: string): string {
  return title.slice(0, PRODUCT_TITLE_MAX - COPY_SUFFIX.length).trimEnd() + COPY_SUFFIX;
}

/** value-copy, value-copy-2, ... each cut to fit. The cut base can end in a hyphen, which a slug may not. */
function candidates(value: string, marker: string, maxLength: number): string[] {
  return Array.from({ length: COPY_ATTEMPTS }, (_, index) => {
    const suffix = marker + (index === 0 ? '' : '-' + (index + 1));
    return value.slice(0, maxLength - suffix.length).replace(/-+$/, '') + suffix;
  });
}

/** Trash keeps its slug (D-041), so this reads every product of the store. */
async function freeSlug(storeId: string, slug: string): Promise<string> {
  const options = candidates(slug, '-copy', PRODUCT_SLUG_MAX);
  const holders = (await Product.find({ store: storeId, slug: { $in: options } }).select('slug').lean()) as unknown as Array<{ slug: string }>;
  const taken = new Set(holders.map((holder) => holder.slug));
  const free = options.find((option) => !taken.has(option));
  if (free === undefined) throw new ProductRequestError(409, 'PRODUCT_SLUG_TAKEN', 'Too many copies of this product exist. Rename one first.');
  return free;
}

/** One new SKU per SKU of the source. Trash keeps its SKUs too (D-041). */
async function freeSkus(storeId: string, variants: readonly VariantRow[]): Promise<Map<string, string>> {
  const skus = [...new Set(variants.flatMap((variant) => (variant.sku ? [variant.sku] : [])))];
  if (skus.length === 0) return new Map();

  const options = new Map(skus.map((sku) => [sku, candidates(sku, '-COPY', SKU_MAX)]));
  const wanted = [...options.values()].flat();
  const holders = (await Product.find({ store: storeId, 'variants.sku': { $in: wanted } }).select('variants.sku').lean()) as unknown as Array<{
    variants: Array<{ sku?: string | null }>;
  }>;
  const taken = new Set(holders.flatMap((holder) => holder.variants.flatMap((variant) => (variant.sku ? [variant.sku] : []))));

  const chosen = new Map<string, string>();
  for (const [sku, list] of options) {
    const free = list.find((option) => !taken.has(option));
    if (free === undefined) throw new ProductRequestError(409, 'SKU_COPY_FAILED', 'Too many copies use SKU ' + sku + '. Change it first.');
    taken.add(free);
    chosen.set(sku, free);
  }
  return chosen;
}

/**
 * A draft copy of a product of this store. The copy links the same Media rows: nothing is uploaded and no Media row is made.
 * Variants take new ids from the database, because none is passed. Ratings and counts start at zero.
 *
 *   404 not this store's, or in trash    403 PRODUCT_TAKEN_DOWN a seller must not re-list removed content
 *   422 PRODUCT_DEMO_NOT_DUPLICABLE      the sample product
 */
export async function duplicateProduct(storeId: string, productId: string): Promise<string> {
  const source = (await Product.findOne({ _id: productId, store: storeId }).lean()) as unknown as SourceProduct | null;
  if (!source || source.deletedAt) throw productNotFound();
  if (source.moderation) throw takenDown(source.moderation.reason);
  if (source.isDemo === true) throw new ProductRequestError(422, 'PRODUCT_DEMO_NOT_DUPLICABLE', 'This is the sample product. Edit it first, then duplicate it.');

  // The free slug and SKUs are read, then written. A writer that takes one in between makes the create fail on a unique
  // index (E11000); reading again then finds the next -copy / -COPY candidate. After the last attempt the refusal stands:
  // 409 SKU_TAKEN for a SKU, 409 PRODUCT_SLUG_TAKEN for a slug (handleProductError).
  for (let attempt = 1; ; attempt += 1) {
    try {
      const [slug, skus] = await Promise.all([freeSlug(storeId, source.slug), freeSkus(storeId, source.variants)]);
      const ordered = [...source.variants].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const { options, variants, minPrice } = await prepareProductVariants(storeId, {
        options: (source.options ?? []).map(({ name, values }) => ({ name, values: [...values] })),
        variants: ordered.map((variant) => ({
          sku: variant.sku ? (skus.get(variant.sku) ?? null) : null,
          barcode: variant.barcode ?? null,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice ?? null,
          trackQuantity: variant.trackQuantity,
          stockQuantity: variant.stockQuantity,
          lowStockThreshold: variant.lowStockThreshold ?? null,
          optionValues: [...(variant.optionValues ?? [])],
          imageId: variant.imageId ? String(variant.imageId) : null,
        })),
      });

      const created = await Product.create({
        store: storeId,
        title: copyTitle(source.title),
        slug,
        categories: source.categories ?? [],
        media: source.media ?? [],
        videos: source.videos ?? [],
        description: source.description ?? null,
        highlights: (source.highlights ?? []).map(({ text }) => ({ text })),
        tags: source.tags ?? [],
        options,
        variants,
        minPrice,
        deliveryCharge: source.deliveryCharge ?? null,
        isFeatured: source.isFeatured === true,
        hideWhenOutOfStock: source.hideWhenOutOfStock === true,
        seoTitle: source.seoTitle ?? null,
        seoDescription: source.seoDescription ?? null,
        seoImage: source.seoImage ?? null,
        isPublished: false,
        isDemo: false,
        moderation: null,
        deletedAt: null,
        viewCount: 0,
        avgRating: 0,
        reviewCount: 0,
      });
      return String(created._id);
    } catch (err) {
      if (!isDuplicateKeyError(err) || attempt >= DUPLICATE_WRITE_ATTEMPTS) {
        if (isSkuDuplicateError(err)) throw skuTakenFromDuplicate(err);
        throw err;
      }
    }
  }
}
