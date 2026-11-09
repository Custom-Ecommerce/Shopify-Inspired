import { z } from 'zod';
import { DISCOUNT_CODE_MAX } from './checkout';
import { PRICE_MAX_PKR, wholeRupeesSchema } from './money';
import { objectIdSchema } from './object-id';

/** Every type a stored discount can hold. The last two are from before D-080: they stay in the database and no longer work. */
export const DISCOUNT_TYPES = ['percentage', 'fixed_amount', 'free_delivery', 'buy_x_get_y'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** The types a new code can have, and the only ones checkout accepts (D-080). */
export const DISCOUNT_ACTIVE_TYPES = ['percentage', 'fixed_amount'] as const;

const isoDate = z.string().datetime({ offset: true });

/** What is wrong with this value for this type, or null. PATCH has no type in its body, so the route asks this with the stored one. */
export function discountValueProblem(type: string, value: number): string | null {
  if (type === 'percentage') return Number.isInteger(value) && value >= 1 && value <= 100 ? null : 'Enter a whole percentage from 1 to 100.';
  if (type === 'fixed_amount') {
    return Number.isInteger(value) && value >= 1 && value <= PRICE_MAX_PKR ? null : 'Enter a whole rupee amount of at least 1.';
  }
  return 'This kind of code can no longer be changed.';
}

export function discountDatesProblem(startDate: string | Date | null | undefined, endDate: string | Date | null | undefined): string | null {
  if (!startDate || !endDate) return null;
  return new Date(endDate).getTime() > new Date(startDate).getTime() ? null : 'The end date must be after the start date.';
}

/** A discount as the seller dashboard reads it. */
export const discountSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  code: z.string().min(1),
  type: z.enum(DISCOUNT_TYPES),
  value: z.number().min(0),
  minOrderAmount: z.number().min(0).nullable().optional(),
  maxUses: z.number().int().min(0).nullable().optional(),
  usedCount: z.number().int().min(0),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  applicableProducts: z.array(objectIdSchema),
  isActive: z.boolean(),
  /** Set when the seller archives the code. An archived code stops working; past orders keep their own copy of the rule. */
  archivedAt: isoDate.nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** POST /api/discounts. The store comes from the session, never from the body (strict). The code is stored in capitals. */
export const createDiscountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Enter a code.')
      .max(DISCOUNT_CODE_MAX, 'Use at most ' + DISCOUNT_CODE_MAX + ' characters.')
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dashes and underscores only.')
      .transform((code) => code.toUpperCase()),
    type: z.enum(DISCOUNT_ACTIVE_TYPES),
    value: z.number(),
    minOrderAmount: wholeRupeesSchema.nullable().optional(),
    maxUses: z.number().int().min(0).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    applicableProducts: z.array(objectIdSchema).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const value = discountValueProblem(input.type, input.value);
    if (value !== null) context.addIssue({ code: 'custom', path: ['value'], message: value });
    const dates = discountDatesProblem(input.startDate, input.endDate);
    if (dates !== null) context.addIssue({ code: 'custom', path: ['endDate'], message: dates });
  });

/**
 * PATCH /api/discounts/:id. The code and type never change. value is range-checked by the route against the stored type,
 * and archived sets or clears archivedAt.
 */
export const updateDiscountSchema = z
  .object({
    value: z.number().optional(),
    minOrderAmount: wholeRupeesSchema.nullable().optional(),
    maxUses: z.number().int().min(0).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    isActive: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export type Discount = z.infer<typeof discountSchema>;
export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
