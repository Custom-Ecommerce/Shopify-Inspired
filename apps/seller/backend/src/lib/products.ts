import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { productAvailability, variantAvailability } from '@markaz/platform-kit/commerce';
import type {
  ProductCreateRequest,
  ProductUpdateRequest,
  ProductVariantPatch,
  SellerProductCategory,
  SellerProductDetail,
  SellerProductSummary,
  SellerProductTrashInfo,
  SellerProductVariant,
} from '@markaz/contracts';
import { slugFromText } from '@/lib/categories';
import { PRODUCT_DEFAULT_VARIANT_FIELDS, PRODUCT_SLUG_MAX } from '@/lib/contracts';
import { HttpError, handleRouteError, isDuplicateKeyError } from '@/lib/http';
import {
  ProductVariantError,
  isSkuDuplicateError,
  prepareProductVariants,
  skuTakenFromDuplicate,
  withSkuGuard,
  type PreparedProductVariants,
  type PreparedVariant,
} from '@/lib/product-variants';
import { Category, Media, Product, productSkus } from '@/lib/services';
import { trashDaysLeft, trashPurgeDate } from '@/lib/trash';

/** Machine-readable reasons for a refused product write. The dashboard reads them through the proxy. */
export type ProductErrorCode =
  | 'PRODUCT_SLUG_TAKEN'
  | 'PRODUCT_SLUG_REQUIRED'
  | 'PRODUCT_CATEGORY_INVALID'
  | 'PRODUCT_MEDIA_INVALID'
  | 'PRODUCT_CHANGED'
  | 'PRODUCT_DEMO_NOT_EDITED'
  | 'PRODUCT_TITLE_REQUIRED'
  | 'PRODUCT_CATEGORY_REQUIRED'
  | 'PRODUCT_PRICE_REQUIRED'
  | 'PRODUCT_NOT_IN_TRASH'
  | 'PRODUCT_ADMIN_DELETED'
  | 'PRODUCT_TAKEN_DOWN'
  | 'PRODUCT_NOT_MODERATED'
  | 'PRODUCT_IN_SELLER_TRASH'
  | 'PRODUCT_DEMO_NOT_DUPLICABLE'
  | 'SKU_COPY_FAILED'
  | 'PRODUCT_DUPLICATE_BUSY'
  | 'IMPORT_BAD_FILE'
  | 'IMPORT_FILE_TOO_LARGE'
  | 'IMPORT_TOO_MANY_ROWS'
  | 'STOCK_VIA_INVENTORY';

export class ProductRequestError extends HttpError {
  readonly code: ProductErrorCode;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: ProductErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(status, message);
    this.name = 'ProductRequestError';
    this.code = code;
    this.details = details;
  }
}

/** handleRouteError with the product codes kept: { errors: [{ message, code }] }, as the category routes answer. */
export function handleProductError(err: unknown): NextResponse {
  if (err instanceof ProductRequestError || err instanceof ProductVariantError) {
    return NextResponse.json({ errors: [{ message: err.message, code: err.code, ...err.details }] }, { status: err.status });
  }
  // A lost SKU race: the unique (store, skus) index refused the write.
  if (isSkuDuplicateError(err)) {
    const refused = skuTakenFromDuplicate(err);
    return NextResponse.json({ errors: [{ message: refused.message, code: refused.code, ...refused.details }] }, { status: refused.status });
  }
  // Any other duplicate key is the (store, slug) index, so it decides a race the same way it decides a plain clash.
  if (isDuplicateKeyError(err)) {
    return NextResponse.json(
      { errors: [{ message: 'A product with this slug already exists in this store. Products in trash keep their slug.', code: 'PRODUCT_SLUG_TAKEN' }] },
      { status: 409 },
    );
  }
  return handleRouteError(err);
}

export const productNotFound = (): HttpError => new HttpError(404, 'Product not found');

const unique = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => id.toLowerCase()))];

/** populate() has no store scope, so this check on the write path is the only thing keeping a product in its store. */
export async function assertStoreCategories(storeId: string, categoryIds: readonly string[]): Promise<void> {
  const ids = unique(categoryIds);
  const owned = await Category.countDocuments({ store: storeId, _id: { $in: ids } });
  if (owned !== ids.length) {
    throw new ProductRequestError(422, 'PRODUCT_CATEGORY_INVALID', 'Choose categories from this store.');
  }
}

/**
 * Every media id a write names. The gallery, the SEO image and the variant images must be images of this store, and the
 * videos must be videos of this store. A record with no resourceType is an image, so only 'video' counts as one.
 */
export async function assertStoreMedia(
  storeId: string,
  imageIds: ReadonlyArray<string | null | undefined>,
  videoIds: readonly string[] = [],
): Promise<void> {
  const images = unique(imageIds.filter((id): id is string => typeof id === 'string'));
  if (images.length > 0) {
    const owned = await Media.countDocuments({ store: storeId, _id: { $in: images }, resourceType: { $ne: 'video' } });
    if (owned !== images.length) {
      throw new ProductRequestError(422, 'PRODUCT_MEDIA_INVALID', 'Choose images from this store.');
    }
  }
  const videos = unique(videoIds);
  if (videos.length > 0) {
    const owned = await Media.countDocuments({ store: storeId, _id: { $in: videos }, resourceType: 'video' });
    if (owned !== videos.length) {
      throw new ProductRequestError(422, 'PRODUCT_MEDIA_INVALID', 'Choose videos from this store.');
    }
  }
}

/**
 * A variant's picture is one of the product's own gallery images, so a selector can always show it. Runs on the result of
 * a write: the gallery and the variants it will leave behind, so dropping a linked image is refused as well.
 */
export function assertVariantImagesInGallery(mediaIds: readonly unknown[], variants: ReadonlyArray<{ imageId?: unknown }>): void {
  const gallery = new Set(mediaIds.map((id) => String(id).toLowerCase()));
  for (const variant of variants) {
    if (variant.imageId === null || variant.imageId === undefined) continue;
    if (!gallery.has(String(variant.imageId).toLowerCase())) {
      throw new ProductRequestError(422, 'PRODUCT_MEDIA_INVALID', "A variant's image must be one of this product's images.");
    }
  }
}

/**
 * A slug is unique inside a store, and trash keeps its slug (D-041), so a holder in trash blocks it too and is named as such.
 * The unique index still decides a race: see handleProductError.
 */
export async function assertSlugFree(storeId: string, slug: string, productId: string | null = null): Promise<void> {
  const holder = (await Product.findOne({ store: storeId, slug, ...(productId ? { _id: { $ne: productId } } : {}) })
    .select('deletedAt')
    .lean()) as unknown as { deletedAt?: unknown } | null;
  if (!holder) return;
  throw new ProductRequestError(
    409,
    'PRODUCT_SLUG_TAKEN',
    holder.deletedAt
      ? 'A product in trash still holds this slug. Restore it or delete it for good first.'
      : 'A product with this slug already exists in this store.',
  );
}

/** The document fields a create request writes, for the policy check: the Default variant's fields are the variants. */
export function createdFields(body: ProductCreateRequest): string[] {
  const variantFields: readonly string[] = PRODUCT_DEFAULT_VARIANT_FIELDS;
  return [...new Set(Object.keys(body).map((key) => (variantFields.includes(key) ? 'variants' : key)))];
}

/** What a create request says about variants, in the shape prepareProductVariants takes. */
export function createdVariantInput(body: ProductCreateRequest): unknown {
  if (body.variants) {
    // A new variant takes the id the database gives it, never one a client picked.
    return { options: body.options ?? [], variants: body.variants.map(({ id: _id, ...variant }) => variant) };
  }
  const { price, compareAtPrice, sku, barcode, trackQuantity, stockQuantity, lowStockThreshold } = body;
  return { variants: [{ price, compareAtPrice, sku, barcode, trackQuantity, stockQuantity, lowStockThreshold }] };
}

/** A variant as .lean() returns it. */
export interface VariantRow {
  _id: unknown;
  title: string;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  compareAtPrice?: number | null;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold?: number | null;
  optionValues?: string[] | null;
  imageId?: unknown;
  position?: number | null;
}

interface CurrentProduct {
  options?: Array<{ name: string; values: string[] }> | null;
  variants: VariantRow[];
  media?: unknown[] | null;
}

function variantFields(row: VariantRow): Omit<ProductVariantPatch, 'id'> {
  return {
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    price: row.price,
    compareAtPrice: row.compareAtPrice ?? null,
    trackQuantity: row.trackQuantity,
    lowStockThreshold: row.lowStockThreshold ?? null,
    optionValues: [...(row.optionValues ?? [])],
    imageId: row.imageId ? String(row.imageId) : null,
  };
}

/**
 * Merges an update into the product as read, and validates the result as a whole through prepareProductVariants. An
 * existing variant keeps what the request leaves out. D-034: its stock can only be repeated here, never changed. The
 * value read is for that comparison alone: variantsExpression below never writes it.
 */
export async function preparePatchedVariants(
  storeId: string,
  productId: string,
  current: CurrentProduct,
  body: ProductUpdateRequest,
): Promise<PreparedProductVariants> {
  const existing = new Map(current.variants.map((row) => [String(row._id).toLowerCase(), row]));
  const sent: ProductVariantPatch[] = body.variants ?? current.variants.map((row) => ({ id: String(row._id) }));

  const named = new Set<string>();
  const merged = sent.map((variant) => {
    if (!variant.id) return variant;
    const key = variant.id.toLowerCase();
    const row = existing.get(key);
    if (!row || named.has(key)) {
      throw new ProductVariantError(422, 'INVALID_VARIANTS', 'A variant in this request does not match the product.', { variantId: variant.id });
    }
    named.add(key);
    if (variant.stockQuantity !== undefined && variant.stockQuantity !== row.stockQuantity) {
      throw new ProductRequestError(422, 'STOCK_VIA_INVENTORY', 'Adjust stock in Inventory.', { variantId: variant.id });
    }
    return { ...variantFields(row), ...variant, stockQuantity: row.stockQuantity };
  });

  const options = body.options ?? (current.options ?? []).map(({ name, values }) => ({ name, values: [...values] }));
  return prepareProductVariants(storeId, { options, variants: merged }, productId);
}

const objectId = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);

/** In an update pipeline any string starting with $ is a field path, so everything from a seller goes in as a literal. */
const literal = (value: unknown): { $literal: unknown } => ({ $literal: value });

/**
 * Every check of a create, and the document it would write. Nothing is written here, so POST, the import and its dry run
 * all share one path: a new product is always a draft unless its caller decides otherwise.
 */
export async function prepareProductCreate(storeId: string, data: ProductCreateRequest) {
  const slug = data.slug ?? slugFromText(data.title, PRODUCT_SLUG_MAX);
  if (slug === '') {
    throw new ProductRequestError(422, 'PRODUCT_SLUG_REQUIRED', 'This title cannot be turned into a slug. Enter one yourself.');
  }
  await assertSlugFree(storeId, slug);

  await assertStoreCategories(storeId, data.categories);
  await assertStoreMedia(storeId, [...(data.media ?? []), data.seoImage, ...(data.variants ?? []).map((variant) => variant.imageId)], data.videos);
  const { options, variants, minPrice } = await prepareProductVariants(storeId, createdVariantInput(data));
  assertVariantImagesInGallery(data.media ?? [], variants);

  return {
    store: storeId,
    title: data.title,
    slug,
    categories: [...new Set(data.categories)],
    media: [...new Set(data.media ?? [])],
    videos: data.videos ?? [],
    description: data.description ? data.description : null,
    highlights: (data.highlights ?? []).map((text) => ({ text })),
    tags: data.tags ?? [],
    deliveryCharge: data.deliveryCharge ?? null,
    isFeatured: data.isFeatured ?? false,
    hideWhenOutOfStock: data.hideWhenOutOfStock ?? false,
    seoTitle: data.seoTitle ?? null,
    seoDescription: data.seoDescription ?? null,
    seoImage: data.seoImage ?? null,
    options,
    variants,
    minPrice,
    isPublished: false,
    isDemo: false,
  };
}

/** Every check of an update, and the variants it would write. Nothing is written here: see applyProductUpdate. */
export async function prepareProductUpdate(
  storeId: string,
  productId: string,
  data: ProductUpdateRequest,
  current: CurrentProduct,
): Promise<PreparedProductVariants | null> {
  if (data.slug !== undefined) await assertSlugFree(storeId, data.slug, productId);
  if (data.categories) await assertStoreCategories(storeId, data.categories);
  await assertStoreMedia(storeId, [...(data.media ?? []), data.seoImage, ...(data.variants ?? []).map((variant) => variant.imageId)], data.videos);

  const prepared = data.variants || data.options ? await preparePatchedVariants(storeId, productId, current, data) : null;
  assertVariantImagesInGallery(data.media ?? current.media ?? [], prepared?.variants ?? current.variants);
  return prepared;
}

/** The one atomic write of an update (D-036). PATCH and the import both end here. */
export async function applyProductUpdate(
  storeId: string,
  productId: string,
  data: ProductUpdateRequest,
  prepared: PreparedProductVariants | null,
): Promise<void> {
  const updated = await withSkuGuard(() =>
    Product.findOneAndUpdate(productPatchFilter(storeId, productId, prepared), [{ $set: productPatchSet(data, prepared) }], {
      new: true,
    })
      .select('_id')
      .lean(),
  );
  if (!updated) {
    throw new ProductRequestError(409, 'PRODUCT_CHANGED', 'This product changed while you were editing it. Reload and try again.');
  }
}

/** The stock this variant holds at the moment the write runs, read by the database itself. */
function stockAtWriteTime(variantId: mongoose.Types.ObjectId): Record<string, unknown> {
  const match = { $filter: { input: '$variants', as: 'variant', cond: { $eq: ['$$variant._id', literal(variantId)] } } };
  return { $let: { vars: { current: { $arrayElemAt: [match, 0] } }, in: '$$current.stockQuantity' } };
}

function variantExpression(variant: PreparedVariant): Record<string, unknown> {
  const { _id, stockQuantity, imageId, ...fields } = variant;
  const stored = { ...fields, imageId: imageId === null ? null : objectId(imageId) };
  if (_id === undefined) return literal({ _id: new mongoose.Types.ObjectId(), ...stored, stockQuantity });
  const id = objectId(_id);
  return { $mergeObjects: [literal({ _id: id, ...stored }), { stockQuantity: stockAtWriteTime(id) }] };
}

/**
 * The $set of the one update pipeline a PATCH runs. Variants are rewritten in that single atomic write, so options,
 * variants and minPrice always change together, but an existing variant's stockQuantity is an expression over the
 * stored array, not a number: an order's $inc that lands between our read and this write is kept.
 */
export function productPatchSet(body: ProductUpdateRequest, prepared: PreparedProductVariants | null): Record<string, unknown> {
  const { title, slug, description, tags, deliveryCharge, isFeatured, hideWhenOutOfStock, seoTitle, seoDescription, highlights, categories, media, videos, seoImage } =
    body;

  const plain = { title, slug, tags, deliveryCharge, isFeatured, hideWhenOutOfStock, seoTitle, seoDescription };
  const set: Record<string, unknown> = { isDemo: literal(false) };
  for (const [field, value] of Object.entries(plain)) {
    if (value !== undefined) set[field] = literal(value);
  }

  if (description !== undefined) set.description = literal(description === '' ? null : description);
  if (highlights !== undefined) set.highlights = literal(highlights.map((text) => ({ text })));
  if (categories !== undefined) set.categories = literal(unique(categories).map(objectId));
  if (media !== undefined) set.media = literal(unique(media).map(objectId));
  if (videos !== undefined) set.videos = literal(unique(videos).map(objectId));
  if (seoImage !== undefined) set.seoImage = literal(seoImage === null ? null : objectId(seoImage));

  if (prepared) {
    set.options = literal(prepared.options);
    set.variants = prepared.variants.map(variantExpression);
    set.minPrice = literal(prepared.minPrice);
    set.skus = literal(productSkus(prepared.variants));
  }
  return set;
}

/**
 * The filter of that write. A variant we keep must still exist, or its stock expression would have nothing to read, and
 * a product trashed since the read is not edited.
 */
export function productPatchFilter(storeId: string, productId: string, prepared: PreparedProductVariants | null): Record<string, unknown> {
  const kept = (prepared?.variants ?? []).flatMap((variant) => (variant._id === undefined ? [] : [objectId(variant._id)]));
  return { _id: productId, store: storeId, deletedAt: null, ...(kept.length > 0 ? { 'variants._id': { $all: kept } } : {}) };
}

interface PopulatedCategory {
  _id: unknown;
  name?: string | null;
  slug?: string | null;
}

interface PopulatedMedia {
  _id: unknown;
  url?: string | null;
  alt?: string | null;
}

interface PopulatedVideo {
  _id: unknown;
  url?: string | null;
  posterUrl?: string | null;
  duration?: number | null;
}

/** A product as .lean() returns it after populating categories and media. */
export interface SellerProductRow {
  _id: unknown;
  title: string;
  slug: string;
  isPublished?: boolean | null;
  isDemo?: boolean | null;
  isFeatured?: boolean | null;
  hideWhenOutOfStock?: boolean | null;
  deletedAt?: Date | string | null;
  deletedBy?: { role?: string | null; reason?: string | null } | null;
  moderation?: { reason: string; takenDownAt: Date | string } | null;
  description?: string | null;
  highlights?: Array<{ text?: string | null } | null> | null;
  tags?: string[] | null;
  minPrice: number;
  options?: Array<{ name: string; values: string[] }> | null;
  variants: VariantRow[];
  categories?: Array<PopulatedCategory | null> | null;
  media?: Array<PopulatedMedia | null> | null;
  videos?: Array<PopulatedVideo | null> | null;
  deliveryCharge?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoImage?: unknown;
  store?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const isoDate = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value ?? ''));

const byPosition = (variants: readonly VariantRow[]): VariantRow[] =>
  [...variants].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

/** A category that was deleted populates to null and is dropped. */
function categoriesOf(row: SellerProductRow): SellerProductCategory[] {
  return (row.categories ?? [])
    .filter((category): category is PopulatedCategory => !!category)
    .map((category) => ({ id: String(category._id), name: category.name ?? '', slug: category.slug ?? '' }));
}

function trashInfo(row: SellerProductRow): SellerProductTrashInfo | null {
  if (!row.deletedAt) return null;
  const deletedAt = new Date(row.deletedAt);
  return {
    deletedAt: deletedAt.toISOString(),
    purgeAt: trashPurgeDate(deletedAt).toISOString(),
    daysLeft: trashDaysLeft(deletedAt, new Date()),
    restorable: row.deletedBy?.role !== 'admin',
    adminReason: row.deletedBy?.role === 'admin' ? (row.deletedBy.reason ?? null) : null,
  };
}

/** One row of the seller's list. Availability is derived here, through the rule the storefront uses. */
export function toSellerProductSummary(row: SellerProductRow): SellerProductSummary {
  const variants = byPosition(row.variants);
  const cheapest = variants.find((variant) => variant.price === row.minPrice) ?? null;
  const firstImage = row.media?.[0]?.url;

  return {
    id: String(row._id),
    title: row.title,
    slug: row.slug,
    status: row.deletedAt ? 'trash' : row.isPublished ? 'published' : 'draft',
    isDemo: row.isDemo === true,
    isFeatured: row.isFeatured === true,
    hideWhenOutOfStock: row.hideWhenOutOfStock === true,
    trash: trashInfo(row),
    takedown: row.moderation ? { reason: row.moderation.reason, takenDownAt: new Date(row.moderation.takenDownAt).toISOString() } : null,
    description: row.description ?? null,
    highlights: (row.highlights ?? []).flatMap((highlight) => (highlight?.text ? [highlight.text] : [])),
    minPrice: row.minPrice,
    compareAtPrice: cheapest?.compareAtPrice ?? null,
    stockStatus: productAvailability(variants.map(variantAvailability)),
    totalStock: variants.reduce((sum, variant) => sum + (variant.trackQuantity ? variant.stockQuantity : 0), 0),
    variantCount: variants.length,
    imageUrl: firstImage ? firstImage : null,
    categories: categoriesOf(row),
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

function toSellerVariant(row: VariantRow, position: number): SellerProductVariant {
  return {
    id: String(row._id),
    title: row.title,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    price: row.price,
    compareAtPrice: row.compareAtPrice ?? null,
    trackQuantity: row.trackQuantity,
    stockQuantity: row.stockQuantity,
    lowStockThreshold: row.lowStockThreshold ?? null,
    optionValues: [...(row.optionValues ?? [])],
    imageId: row.imageId ? String(row.imageId) : null,
    position: row.position ?? position,
    availability: variantAvailability(row),
  };
}

export function toSellerProductDetail(row: SellerProductRow): SellerProductDetail {
  return {
    ...toSellerProductSummary(row),
    tags: [...(row.tags ?? [])],
    options: (row.options ?? []).map(({ name, values }) => ({ name, values: [...values] })),
    variants: byPosition(row.variants).map(toSellerVariant),
    media: (row.media ?? [])
      .filter((media): media is PopulatedMedia => !!media)
      .map((media) => ({ id: String(media._id), url: media.url ?? '', alt: media.alt ?? null })),
    videos: (row.videos ?? []).flatMap((video) =>
      video?.url ? [{ id: String(video._id), url: video.url, posterUrl: video.posterUrl ?? null, duration: video.duration ?? null }] : [],
    ),
    deliveryCharge: row.deliveryCharge ?? null,
    seoTitle: row.seoTitle ?? null,
    seoDescription: row.seoDescription ?? null,
    seoImage: row.seoImage ? String(row.seoImage) : null,
  };
}

/** One product of one store, with what the edit page shows. Another store's product, or a trashed one, is not found. */
export async function loadSellerProduct(storeId: string, productId: string): Promise<SellerProductDetail> {
  const row = (await Product.findOne({ _id: productId, store: storeId, deletedAt: null })
    .populate({ path: 'categories', select: 'name slug' })
    .populate({ path: 'media', select: 'url alt' })
    .populate({ path: 'videos', select: 'url posterUrl duration' })
    .lean()) as unknown as SellerProductRow | null;
  if (!row) throw productNotFound();
  return toSellerProductDetail(row);
}
