import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Wire shapes of the admin console's catalogue endpoints (apps/admin-portal): platform categories. Identity is id.
 * The limits and the slug pattern are the single definition: the console form and the backend both enforce them.
 */

export const ADMIN_CATEGORY_NAME_MAX = 80;
export const ADMIN_CATEGORY_SLUG_MAX = 80;
export const ADMIN_CATEGORY_DESCRIPTION_MAX = 500;
export const ADMIN_CATEGORY_ORDER_MAX = 9999;
/** Lowercase letters and digits, joined by single hyphens. */
export const ADMIN_CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isoDate = z.string().datetime({ offset: true });

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(ADMIN_CATEGORY_NAME_MAX, 'The name can be at most ' + ADMIN_CATEGORY_NAME_MAX + ' characters.');

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a slug.')
  .max(ADMIN_CATEGORY_SLUG_MAX, 'The slug can be at most ' + ADMIN_CATEGORY_SLUG_MAX + ' characters.')
  .regex(ADMIN_CATEGORY_SLUG_PATTERN, 'Use lowercase letters, numbers, and single hyphens.');

const orderSchema = z
  .number()
  .int('The order must be a whole number.')
  .min(0, 'The order cannot be negative.')
  .max(ADMIN_CATEGORY_ORDER_MAX, 'The order can be at most ' + ADMIN_CATEGORY_ORDER_MAX + '.');

const descriptionSchema = z
  .string()
  .trim()
  .max(ADMIN_CATEGORY_DESCRIPTION_MAX, 'The description can be at most ' + ADMIN_CATEGORY_DESCRIPTION_MAX + ' characters.')
  .nullable();

export const adminCategorySchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  slug: z.string(),
  /** Lower numbers are listed first. */
  order: z.number().int(),
  description: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const adminCategoryListSchema = z.object({
  docs: z.array(adminCategorySchema),
  totalDocs: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

/** Create. A missing slug is made from the name; a missing order is 0. */
export const adminCategoryCreateRequestSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema.optional(),
    order: orderSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict();

/** Update. Only the fields sent change, and at least one must be sent. */
export const adminCategoryUpdateRequestSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    order: orderSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Change at least one field.' });

export const adminCategoryResponseSchema = z.object({ category: adminCategorySchema });

export const adminCategoryDeleteResponseSchema = z.object({ deleted: z.literal(true), id: objectIdSchema });

export type AdminCategory = z.infer<typeof adminCategorySchema>;
export type AdminCategoryList = z.infer<typeof adminCategoryListSchema>;
export type AdminCategoryCreateRequest = z.infer<typeof adminCategoryCreateRequestSchema>;
export type AdminCategoryUpdateRequest = z.infer<typeof adminCategoryUpdateRequestSchema>;
export type AdminCategoryDeleteResponse = z.infer<typeof adminCategoryDeleteResponseSchema>;
