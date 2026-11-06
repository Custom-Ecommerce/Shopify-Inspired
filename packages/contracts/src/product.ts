import { z } from 'zod';
import { compareAtPriceProblem, rupeesInputSchema, wholeRupeesSchema } from './money';
import { objectIdSchema } from './object-id';

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
export type ProductRelation = z.infer<typeof relation>;
export type StockMovement = z.infer<typeof stockMovementSchema>;
