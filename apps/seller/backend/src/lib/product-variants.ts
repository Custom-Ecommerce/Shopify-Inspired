import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { productVariantsInputSchema, variantTitle } from '@/lib/contracts';
import { Product } from '@/lib/services';

export type ProductVariantErrorCode = 'INVALID_VARIANTS' | 'SKU_TAKEN';

/** A refused product write. It is an HttpError, so a route that does not look closer still answers correctly. */
export class ProductVariantError extends HttpError {
  readonly code: ProductVariantErrorCode;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: ProductVariantErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(status, message);
    this.name = 'ProductVariantError';
    this.code = code;
    this.details = details;
  }
}

export interface PreparedVariant {
  _id?: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  compareAtPrice: number | null;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold: number | null;
  optionValues: string[];
  imageId: string | null;
  position: number;
}

export interface PreparedProductVariants {
  options: Array<{ name: string; values: string[] }>;
  variants: PreparedVariant[];
  minPrice: number;
}

const SKU_TAKEN_MESSAGE = (sku: string): string =>
  'Another product in this store already uses SKU ' + sku + '. Products in trash keep their SKUs.';

/**
 * True when a duplicate-key error comes from the unique (store, skus) index, not the (store, slug) one. MongoServerError
 * carries keyPattern; the index name in the message is the fallback.
 */
export function isSkuDuplicateError(err: unknown): boolean {
  if (!isDuplicateKeyError(err)) return false;
  const e = err as { keyPattern?: unknown; message?: unknown };
  if (e.keyPattern && typeof e.keyPattern === 'object') return 'skus' in e.keyPattern;
  return typeof e.message === 'string' && e.message.includes('skus_1');
}

/** The 409 a lost SKU race answers: the same code and wording as the read-then-write check. */
export function skuTakenFromDuplicate(err: unknown): ProductVariantError {
  const value = (err as { keyValue?: { skus?: unknown } }).keyValue?.skus;
  const sku = typeof value === 'string' ? value : null;
  return new ProductVariantError(409, 'SKU_TAKEN', sku ? SKU_TAKEN_MESSAGE(sku) : 'Another product in this store already uses one of these SKUs. Products in trash keep their SKUs.', {
    skus: sku ? [sku] : [],
  });
}

/** Runs a product write and turns a lost SKU race (E11000 on the skus index) into 409 SKU_TAKEN. Other errors pass through. */
export async function withSkuGuard<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (isSkuDuplicateError(err)) throw skuTakenFromDuplicate(err);
    throw err;
  }
}

/** The SKUs of one store that are already held by another product. */
async function skusTakenElsewhere(storeId: string, skus: string[], productId: string | null): Promise<string[]> {
  if (skus.length === 0) return [];
  const rows = (await Product.find({
    store: storeId,
    'variants.sku': { $in: skus },
    ...(productId ? { _id: { $ne: productId } } : {}),
  })
    .select('variants.sku')
    .lean()) as unknown as Array<{ variants: Array<{ sku?: string | null }> }>;

  const wanted = new Set(skus);
  const taken = new Set(rows.flatMap((row) => row.variants.map((variant) => variant.sku ?? '')).filter((sku) => wanted.has(sku)));
  return [...taken];
}

/**
 * The one path every product write goes through: pass it what the seller sent and write what it returns.
 *
 *   422 INVALID_VARIANTS  a rule of the contract is broken: limits, option consistency, compare-at, a SKU repeated
 *                         inside this product. A decimal price is rounded here, before any rule looks at it.
 *   409 SKU_TAKEN         another product of this store holds a SKU. Another store's SKUs never clash, nor do nulls.
 *
 * It returns the derived fields too (variant titles, positions, minPrice), so no caller can forget them.
 *
 * The SKU check reads, then the caller writes, so two simultaneous writes from the same store can both pass it. The
 * unique (store, skus) index decides that race: the second write fails with E11000, which every write path turns into
 * 409 SKU_TAKEN (withSkuGuard, handleProductError). See the note on the index in packages/db-schemas/src/models/product.ts.
 * A SKU repeated inside ONE product is not something that index can see; the contract check above refuses it.
 *
 * Pass productId when updating, so a product does not clash with itself.
 */
export async function prepareProductVariants(
  storeId: string,
  input: unknown,
  productId: string | null = null,
): Promise<PreparedProductVariants> {
  const parsed = productVariantsInputSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
    throw new ProductVariantError(422, 'INVALID_VARIANTS', issues[0]?.message ?? 'The variants are not valid.', { issues });
  }
  const { options, variants } = parsed.data;

  const skus = variants.flatMap((variant) => (variant.sku === null ? [] : [variant.sku]));
  const taken = await skusTakenElsewhere(storeId, skus, productId);
  if (taken.length > 0) {
    throw new ProductVariantError(409, 'SKU_TAKEN', SKU_TAKEN_MESSAGE(taken[0] as string), { skus: taken });
  }

  return {
    options,
    variants: variants.map(({ id, ...variant }, position) => ({
      ...(id ? { _id: id } : {}),
      ...variant,
      title: variantTitle(variant.optionValues),
      position,
    })),
    minPrice: Math.min(...variants.map((variant) => variant.price)),
  };
}
