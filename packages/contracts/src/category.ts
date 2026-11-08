import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Store categories. A seller owns the categories of their store. The limits and the slug pattern are the single
 * definition: the seller backend enforces them, and the storefront accepts every slug they allow.
 */

export const CATEGORY_NAME_MAX = 80;
/** STOREFRONT_CATEGORY_SLUG_PATTERN stops at 64 characters, so a longer slug could never be filtered on. */
export const CATEGORY_SLUG_MAX = 64;
export const CATEGORY_DESCRIPTION_MAX = 500;
export const CATEGORY_ORDER_MAX = 9999;
/** Lowercase letters and digits, joined by single hyphens. */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const categorySchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  order: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  banner: z.union([objectIdSchema, z.object({ id: objectIdSchema, url: z.string().nullable().optional() })]).nullable().optional(),
  isDemo: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(CATEGORY_NAME_MAX, 'The name can be at most ' + CATEGORY_NAME_MAX + ' characters.');

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a slug.')
  .max(CATEGORY_SLUG_MAX, 'The slug can be at most ' + CATEGORY_SLUG_MAX + ' characters.')
  .regex(CATEGORY_SLUG_PATTERN, 'Use lowercase letters, numbers, and single hyphens.');

const orderSchema = z
  .number()
  .int('The order must be a whole number.')
  .min(0, 'The order cannot be negative.')
  .max(CATEGORY_ORDER_MAX, 'The order can be at most ' + CATEGORY_ORDER_MAX + '.');

const descriptionSchema = z
  .string()
  .trim()
  .max(CATEGORY_DESCRIPTION_MAX, 'The description can be at most ' + CATEGORY_DESCRIPTION_MAX + ' characters.')
  .nullable();

/** Create. A missing slug is made from the name; a missing order puts the category last. The store is never sent. */
export const categoryCreateRequestSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema.optional(),
    order: orderSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict();

/** Update. Only the fields sent change, and at least one must be sent. A new name leaves the slug alone. */
export const categoryUpdateRequestSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    order: orderSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Change at least one field.' });

export type Category = z.infer<typeof categorySchema>;
export type CategoryCreateRequest = z.infer<typeof categoryCreateRequestSchema>;
export type CategoryUpdateRequest = z.infer<typeof categoryUpdateRequestSchema>;
