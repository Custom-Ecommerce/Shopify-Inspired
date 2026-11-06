import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** Discount types, as apps/admin/src/collections/Discounts.ts defines them. */
export const DISCOUNT_TYPES = ['percentage', 'fixed_amount', 'free_delivery', 'buy_x_get_y'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

const isoDate = z.string().datetime({ offset: true });

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
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** POST /api/discounts. The store comes from the session, never from the body (strict). */
export const createDiscountSchema = z
  .object({
    code: z.string().min(1).max(40),
    type: z.enum(DISCOUNT_TYPES),
    value: z.number().min(0),
    minOrderAmount: z.number().min(0).nullable().optional(),
    maxUses: z.number().int().min(0).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    applicableProducts: z.array(objectIdSchema).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/discounts/:id. Only these three fields may change; anything else is refused. */
export const updateDiscountSchema = z
  .object({
    isActive: z.boolean().optional(),
    maxUses: z.number().int().min(0).nullable().optional(),
    endDate: isoDate.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export type Discount = z.infer<typeof discountSchema>;
export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
