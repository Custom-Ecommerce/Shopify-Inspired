import { z } from 'zod';
import { compareAtPriceProblem, rupeesInputSchema, wholeRupeesSchema } from './money';
import { objectIdSchema } from './object-id';
import type { StockStatus } from './stock-status';

/** A relation as the frontend reads it: the ObjectId, or the populated document (depth 1). */
const populatedRef = z.object({
  id: objectIdSchema,
  name: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});
const relation = z.union([objectIdSchema, populatedRef]);

export const PRODUCT_MAX_OPTIONS = 3;
export const PRODUCT_MAX_VARIANTS = 100;
export const PRODUCT_OPTION_NAME_MAX = 40;
export const PRODUCT_OPTION_MAX_VALUES = 50;
export const PRODUCT_OPTION_VALUE_MAX = 60;
export const PRODUCT_VARIANT_CODE_MAX = 64;
/** The title of the one variant a product with no options has. */
export const DEFAULT_VARIANT_TITLE = 'Default';

/** Payload stores highlights as rows with a text subfield. */
export const highlightSchema = z.object({ text: z.string().min(1) });

/** One stock change on one variant. History lives in its own collection, not on the product. */
export const stockMovementSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  product: objectIdSchema,
  variantId: objectIdSchema,
  previousQuantity: z.number().int(),
  quantity: z.number().int(),
  delta: z.number().int(),
  reason: z.string().min(1),
  changedAt: z.string().datetime({ offset: true }),
  actor: objectIdSchema.nullable().optional(),
});

const duplicateIgnoringCase = (values: readonly string[]): string | null => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) return value;
    seen.add(key);
  }
  return null;
};

export const productOptionSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter an option name.').max(PRODUCT_OPTION_NAME_MAX),
    values: z.array(z.string().trim().min(1).max(PRODUCT_OPTION_VALUE_MAX)).min(1).max(PRODUCT_OPTION_MAX_VALUES),
  })
  .strict();

export type ProductOption = z.infer<typeof productOptionSchema>;

/** Empty text means "no code". */
const optionalCode = z
  .string()
  .trim()
  .max(PRODUCT_VARIANT_CODE_MAX)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

/** A variant as a seller sends it. A decimal price is rounded here; id keeps an existing variant's identity. */
export const productVariantInputSchema = z
  .object({
    id: objectIdSchema.optional(),
    sku: optionalCode,
    barcode: optionalCode,
    price: rupeesInputSchema,
    compareAtPrice: rupeesInputSchema.nullable().optional().transform((value) => value ?? null),
    trackQuantity: z.boolean().default(true),
    stockQuantity: z.number().int().min(0).default(0),
    lowStockThreshold: z.number().int().min(0).nullable().optional().transform((value) => value ?? null),
    optionValues: z.array(z.string().trim().min(1)).default([]),
    imageId: objectIdSchema.nullable().optional().transform((value) => value ?? null),
  })
  .strict();

export type ProductVariantInput = z.output<typeof productVariantInputSchema>;

export interface VariantSetProblem {
  path: Array<string | number>;
  message: string;
}

/**
 * Every rule about a product's options and variants taken together. The request contract and the server's write path
 * both use this, so a rule cannot be enforced in one and forgotten in the other.
 */
export function variantSetProblems(options: readonly ProductOption[], variants: readonly ProductVariantInput[]): VariantSetProblem[] {
  const problems: VariantSetProblem[] = [];

  const duplicateName = duplicateIgnoringCase(options.map((option) => option.name));
  if (duplicateName !== null) problems.push({ path: ['options'], message: 'Option "' + duplicateName + '" is listed twice.' });

  options.forEach((option, index) => {
    const duplicateValue = duplicateIgnoringCase(option.values);
    if (duplicateValue !== null) {
      problems.push({ path: ['options', index, 'values'], message: 'Value "' + duplicateValue + '" is listed twice.' });
    }
  });

  if (options.length === 0 && variants.length !== 1) {
    problems.push({ path: ['variants'], message: 'A product with no options has exactly one variant.' });
  }

  const combinations = new Set<string>();
  const skus = new Set<string>();

  variants.forEach((variant, index) => {
    const compareAt = compareAtPriceProblem(variant.price, variant.compareAtPrice);
    if (compareAt !== null) problems.push({ path: ['variants', index, 'compareAtPrice'], message: compareAt });

    if (variant.optionValues.length !== options.length) {
      problems.push({ path: ['variants', index, 'optionValues'], message: 'Give one value for each option, in order.' });
      return;
    }
    variant.optionValues.forEach((value, position) => {
      if (!options[position].values.includes(value)) {
        problems.push({
          path: ['variants', index, 'optionValues', position],
          message: '"' + value + '" is not a value of ' + options[position].name + '.',
        });
      }
    });

    const combination = JSON.stringify(variant.optionValues);
    if (combinations.has(combination)) {
      problems.push({ path: ['variants', index, 'optionValues'], message: 'Two variants have the same options.' });
    }
    combinations.add(combination);

    if (variant.sku !== null) {
      if (skus.has(variant.sku)) problems.push({ path: ['variants', index, 'sku'], message: 'Two variants have the same SKU.' });
      skus.add(variant.sku);
    }
  });

  return problems;
}

/** The options and variants of one product, as a seller sends them. */
export const productVariantsInputSchema = z
  .object({
    options: z.array(productOptionSchema).max(PRODUCT_MAX_OPTIONS).default([]),
    variants: z.array(productVariantInputSchema).min(1).max(PRODUCT_MAX_VARIANTS),
  })
  .strict()
  .superRefine((value, context) => {
    for (const problem of variantSetProblems(value.options, value.variants)) {
      context.addIssue({ code: 'custom', path: problem.path, message: problem.message });
    }
  });

export type ProductVariantsInput = z.output<typeof productVariantsInputSchema>;

/** The title a variant is shown under: its option values, or "Default" when the product has no options. */
export function variantTitle(optionValues: readonly string[]): string {
  return optionValues.length === 0 ? DEFAULT_VARIANT_TITLE : optionValues.join(' / ');
}

export const PRODUCT_TITLE_MAX = 200;
export const PRODUCT_SLUG_MAX = 200;
/** Lowercase letters and digits, joined by single hyphens. */
export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PRODUCT_DESCRIPTION_MAX = 5000;
export const PRODUCT_MAX_HIGHLIGHTS = 10;
export const PRODUCT_HIGHLIGHT_MAX = 200;
export const PRODUCT_MAX_TAGS = 30;
export const PRODUCT_TAG_MAX = 50;
export const PRODUCT_MAX_CATEGORIES = 20;
export const PRODUCT_MAX_IMAGES = 10;
export const PRODUCT_MAX_VIDEOS = 4;
export const PRODUCT_SEO_TITLE_MAX = 200;
export const PRODUCT_SEO_DESCRIPTION_MAX = 500;

/** Something that reads as an HTML tag. "3 < 5" is fine; "<b>" and "<!-- x -->" are not. */
export function containsHtmlTag(text: string): boolean {
  return /<\/?[a-z!][^>]*>/i.test(text);
}

const NO_HTML = 'Use plain text: HTML tags are not allowed.';

const productTitleSchema = z.string().trim().min(1, 'Enter a title.').max(PRODUCT_TITLE_MAX);

const productSlugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a slug.')
  .max(PRODUCT_SLUG_MAX)
  .regex(PRODUCT_SLUG_PATTERN, 'Use lowercase letters, numbers, and single hyphens.');

const productCategoriesSchema = z.array(objectIdSchema).min(1, 'Choose at least one category.').max(PRODUCT_MAX_CATEGORIES);

/** The fields of a product that are not its identity or its variants. D-008: plain text only; HTML is refused, never stripped. */
const productContentFields = {
  description: z
    .string()
    .trim()
    .max(PRODUCT_DESCRIPTION_MAX)
    .refine((value) => !containsHtmlTag(value), NO_HTML)
    .nullable()
    .optional(),
  highlights: z
    .array(z.string().trim().min(1).max(PRODUCT_HIGHLIGHT_MAX).refine((value) => !containsHtmlTag(value), NO_HTML))
    .max(PRODUCT_MAX_HIGHLIGHTS)
    .optional(),
  tags: z.array(z.string().trim().min(1).max(PRODUCT_TAG_MAX)).max(PRODUCT_MAX_TAGS).optional(),
  media: z.array(objectIdSchema).max(PRODUCT_MAX_IMAGES).optional(),
  /** The whole ordered list when sent. */
  videos: z
    .array(objectIdSchema)
    .max(PRODUCT_MAX_VIDEOS)
    .refine((ids) => duplicateIgnoringCase(ids) === null, 'A video is listed twice.')
    .optional(),
  deliveryCharge: rupeesInputSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  hideWhenOutOfStock: z.boolean().optional(),
  seoTitle: z.string().trim().max(PRODUCT_SEO_TITLE_MAX).nullable().optional(),
  seoDescription: z.string().trim().max(PRODUCT_SEO_DESCRIPTION_MAX).nullable().optional(),
  seoImage: objectIdSchema.nullable().optional(),
};

const variantCodeField = z.string().trim().max(PRODUCT_VARIANT_CODE_MAX).nullable().optional();
const thresholdField = z.number().int().min(0).nullable().optional();

/** Without options a create request carries these directly: they describe the Default variant. */
export const PRODUCT_DEFAULT_VARIANT_FIELDS = [
  'price',
  'compareAtPrice',
  'sku',
  'barcode',
  'trackQuantity',
  'stockQuantity',
  'lowStockThreshold',
] as const;

/**
 * Create. Either the Default variant's fields, or options with variants, never both. A missing slug is made from the
 * title. The store, the status and every derived field are never sent: an unknown key is refused.
 */
export const productCreateRequestSchema = z
  .object({
    title: productTitleSchema,
    slug: productSlugSchema.optional(),
    categories: productCategoriesSchema,
    ...productContentFields,
    options: z.array(productOptionSchema).max(PRODUCT_MAX_OPTIONS).optional(),
    variants: z.array(productVariantInputSchema).min(1).max(PRODUCT_MAX_VARIANTS).optional(),
    price: rupeesInputSchema.optional(),
    compareAtPrice: rupeesInputSchema.nullable().optional(),
    sku: variantCodeField,
    barcode: variantCodeField,
    trackQuantity: z.boolean().optional(),
    stockQuantity: z.number().int().min(0).optional(),
    lowStockThreshold: thresholdField,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.variants) {
      for (const field of PRODUCT_DEFAULT_VARIANT_FIELDS) {
        if (value[field] !== undefined) {
          context.addIssue({ code: 'custom', path: [field], message: 'Send this on the variant, not on the product.' });
        }
      }
      return;
    }
    if ((value.options ?? []).length > 0) {
      context.addIssue({ code: 'custom', path: ['variants'], message: 'A product with options needs its variants.' });
    }
    if (value.price === undefined) context.addIssue({ code: 'custom', path: ['price'], message: 'Enter a price.' });
  });

/**
 * One variant in an update. An id names an existing variant and only the fields sent change; no id adds a variant,
 * which then needs a price. Numbers stay raw here: the variant write path rounds and validates the merged result.
 * The title follows from optionValues and the position from the order of the list, so neither is sent.
 */
export const productVariantPatchSchema = z
  .object({
    id: objectIdSchema.optional(),
    sku: variantCodeField,
    barcode: variantCodeField,
    price: z.number().optional(),
    compareAtPrice: z.number().nullable().optional(),
    trackQuantity: z.boolean().optional(),
    stockQuantity: z.number().int().min(0).optional(),
    lowStockThreshold: thresholdField,
    optionValues: z.array(z.string()).optional(),
    imageId: objectIdSchema.nullable().optional(),
  })
  .strict();

/**
 * Update. Only the fields sent change, and at least one must be sent. variants, when sent, is the whole list: an
 * existing variant left out is removed. A client that changes no variant sends no variants.
 */
export const productUpdateRequestSchema = z
  .object({
    title: productTitleSchema.optional(),
    slug: productSlugSchema.optional(),
    categories: productCategoriesSchema.optional(),
    ...productContentFields,
    options: z.array(productOptionSchema).max(PRODUCT_MAX_OPTIONS).optional(),
    variants: z.array(productVariantPatchSchema).min(1).max(PRODUCT_MAX_VARIANTS).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Change at least one field.' });

export type ProductCreateRequest = z.output<typeof productCreateRequestSchema>;
export type ProductUpdateRequest = z.output<typeof productUpdateRequestSchema>;
export type ProductVariantPatch = z.output<typeof productVariantPatchSchema>;

export const PRODUCT_LIST_STATUSES = ['all', 'draft', 'published', 'trash'] as const;
export const PRODUCT_LIST_SORTS = ['newest', 'oldest', 'title', 'price'] as const;
export type ProductListStatus = (typeof PRODUCT_LIST_STATUSES)[number];
export type ProductListSort = (typeof PRODUCT_LIST_SORTS)[number];

export const productVariantSchema = z.object({
  id: objectIdSchema,
  title: z.string().min(1),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  price: wholeRupeesSchema,
  compareAtPrice: wholeRupeesSchema.nullable(),
  trackQuantity: z.boolean(),
  stockQuantity: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).nullable(),
  optionValues: z.array(z.string()),
  imageId: objectIdSchema.nullable(),
  position: z.number().int().min(0),
});

/** A product as the seller dashboard reads it. Price and stock live on the variants. */
export const productSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  title: z.string().min(1),
  slug: z.string().min(1),
  categories: z.array(relation).min(1),
  media: z.array(relation),
  description: z.string().nullable().optional(),
  highlights: z.array(highlightSchema).optional(),
  options: z.array(productOptionSchema).max(PRODUCT_MAX_OPTIONS),
  variants: z.array(productVariantSchema).min(1).max(PRODUCT_MAX_VARIANTS),
  /** The cheapest variant's price, kept on the product so a listing can sort by it. */
  minPrice: wholeRupeesSchema,
  deliveryCharge: wholeRupeesSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  seoImage: relation.nullable().optional(),
  avgRating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  viewCount: z.number().int().min(0).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Product = z.infer<typeof productSchema>;
export type ProductVariant = z.infer<typeof productVariantSchema>;

/** D-010: how long a product waits in trash before the retention job purges it. */
export const PRODUCT_TRASH_RETENTION_DAYS = 365;

/** Where a trashed product stands. Derived by the backend, so the dashboard only shows it. */
export interface SellerProductTrashInfo {
  deletedAt: string;
  purgeAt: string;
  daysLeft: number;
  /** False when an admin deleted it: the seller may look, not bring it back. */
  restorable: boolean;
}

export interface SellerProductCategory {
  id: string;
  name: string;
  slug: string;
}

/** One row of the seller's product list. Stock status and totals are derived by the backend, never by the dashboard. */
export interface SellerProductSummary {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'trash';
  isDemo: boolean;
  isFeatured: boolean;
  hideWhenOutOfStock: boolean;
  /** Null unless the product is in trash. */
  trash: SellerProductTrashInfo | null;
  description: string | null;
  highlights: string[];
  minPrice: number;
  /** The compare-at of the cheapest variant, if it has one. */
  compareAtPrice: number | null;
  stockStatus: StockStatus;
  /** Units across the variants that track quantity. */
  totalStock: number;
  variantCount: number;
  imageUrl: string | null;
  categories: SellerProductCategory[];
  createdAt: string;
  updatedAt: string;
}

/** A video of a product, as the dashboard and the storefront show it. */
export interface SellerProductVideo {
  id: string;
  url: string;
  posterUrl: string | null;
  duration: number | null;
}

export interface SellerProductVariant extends ProductVariant {
  availability: StockStatus;
}

/** One product as the seller's edit page reads it. */
export interface SellerProductDetail extends SellerProductSummary {
  tags: string[];
  options: Array<{ name: string; values: string[] }>;
  variants: SellerProductVariant[];
  media: Array<{ id: string; url: string; alt: string | null }>;
  videos: SellerProductVideo[];
  deliveryCharge: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoImage: string | null;
}

export const INVENTORY_ADJUST_MAX_LINES = 100;
export const INVENTORY_REASON_MAX = 200;
export const INVENTORY_QUANTITY_MAX = 1_000_000;

/** One stock change. Either a delta, or the count the seller just took (setTo), never both. */
export const inventoryAdjustLineSchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema,
    delta: z
      .number()
      .int()
      .min(-INVENTORY_QUANTITY_MAX)
      .max(INVENTORY_QUANTITY_MAX)
      .refine((value) => value !== 0, 'Enter a change other than 0.')
      .optional(),
    setTo: z.number().int().min(0).max(INVENTORY_QUANTITY_MAX).optional(),
    reason: z.string().trim().min(1, 'Enter a reason.').max(INVENTORY_REASON_MAX),
  })
  .strict()
  .refine((line) => (line.delta === undefined) !== (line.setTo === undefined), 'Send either delta or setTo.');

/** POST /api/inventory/adjust. The store comes from the session, never from the body. */
export const inventoryAdjustRequestSchema = z
  .object({ lines: z.array(inventoryAdjustLineSchema).min(1).max(INVENTORY_ADJUST_MAX_LINES) })
  .strict();

export type InventoryAdjustLine = z.output<typeof inventoryAdjustLineSchema>;
export type InventoryAdjustRequest = z.output<typeof inventoryAdjustRequestSchema>;

export type InventoryLineErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_NOT_TRACKED'
  | 'STOCK_WOULD_GO_NEGATIVE'
  | 'STOCK_CHANGED'
  | 'STOCK_WRITE_FAILED';

/** The answer for one line, in request order. One refused line never undoes another. */
export type InventoryAdjustResult =
  | { ok: true; productId: string; variantId: string; previousQuantity: number; delta: number; quantity: number; availability: StockStatus }
  | { ok: false; productId: string; variantId: string; status: number; code: InventoryLineErrorCode; message: string };

export interface InventoryAdjustResponse {
  results: InventoryAdjustResult[];
  succeeded: number;
  failed: number;
}

/** One variant on the inventory page. Availability is derived by the backend. */
export interface InventoryVariant {
  id: string;
  title: string;
  sku: string | null;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold: number | null;
  availability: StockStatus;
}

export interface InventoryProduct {
  id: string;
  title: string;
  status: 'draft' | 'published';
  isDemo: boolean;
  stockStatus: StockStatus;
  variants: InventoryVariant[];
}

/** One row of the stock history. actor is null for a change an order made. */
export interface StockHistoryEntry {
  id: string;
  variantId: string;
  previousQuantity: number;
  delta: number;
  quantity: number;
  reason: string;
  actor: string | null;
  changedAt: string;
}

export type ProductRelation = z.infer<typeof relation>;
export type StockMovement = z.infer<typeof stockMovementSchema>;
