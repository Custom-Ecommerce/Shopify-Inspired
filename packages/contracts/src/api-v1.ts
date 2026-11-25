import { z } from 'zod';

/*
 * Sprint 8 (S8-B5, D-118): the response shapes of the read-only public API v1. VERSIONED AND FROZEN: third parties build on these names, so a field is never renamed
 * or removed in v1 (test/api-v1.test.ts lists every name and fails when one changes). Every object is strict: a field added by mistake (a customer's name above all)
 * fails the parse instead of being answered. Money is whole rupees; dates are ISO 8601 in UTC.
 *
 * Orders carry the CITY only about the customer: no name, phone, email or address.
 */

export const API_V1_VERSION = 'v1';
export const API_V1_LIMIT_DEFAULT = 20;
export const API_V1_LIMIT_MAX = 100;

export const API_V1_PRODUCT_STATUSES = ['published', 'draft', 'taken_down'] as const;
export type ApiV1ProductStatus = (typeof API_V1_PRODUCT_STATUSES)[number];

export const API_V1_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN_SCOPE',
  'STORE_UNAVAILABLE',
  'PLAN_LIMIT_REACHED',
  'INVALID_REQUEST',
  'NOT_FOUND',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
] as const;
export type ApiV1ErrorCode = (typeof API_V1_ERROR_CODES)[number];

const rupees = z.number().int().min(0);
const isoDate = z.string().datetime();

export const apiV1CategorySchema = z.strictObject({ id: z.string(), name: z.string(), slug: z.string() });

export const apiV1ImageSchema = z.strictObject({ url: z.string(), alt: z.string() });

export const apiV1ProductSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  /** The lowest price of the product's variants. */
  price: rupees,
  comparePrice: rupees.nullable(),
  /** Units in stock over all variants; null when a variant does not track quantity. */
  stock: z.number().int().min(0).nullable(),
  status: z.enum(API_V1_PRODUCT_STATUSES),
  /** The product's first category. */
  category: apiV1CategorySchema.nullable(),
  images: z.array(apiV1ImageSchema),
  updatedAt: isoDate,
});
export type ApiV1Product = z.output<typeof apiV1ProductSchema>;

export const apiV1OrderItemSchema = z.strictObject({
  productId: z.string(),
  variantId: z.string(),
  name: z.string(),
  variantName: z.string(),
  sku: z.string().nullable(),
  unitPrice: rupees,
  quantity: z.number().int().min(1),
});

export const apiV1OrderSchema = z.strictObject({
  id: z.string(),
  orderId: z.string(),
  status: z.string(),
  paymentMethod: z.string().nullable(),
  paymentStatus: z.string(),
  items: z.array(apiV1OrderItemSchema),
  subtotal: rupees,
  deliveryCharges: rupees,
  discount: rupees,
  taxAmount: rupees,
  total: rupees,
  city: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ApiV1Order = z.output<typeof apiV1OrderSchema>;

export const apiV1ProductListSchema = z.strictObject({ data: z.array(apiV1ProductSchema), nextCursor: z.string().nullable() });
export const apiV1ProductDetailSchema = z.strictObject({ data: apiV1ProductSchema });
export const apiV1OrderListSchema = z.strictObject({ data: z.array(apiV1OrderSchema), nextCursor: z.string().nullable() });
export const apiV1OrderDetailSchema = z.strictObject({ data: apiV1OrderSchema });

export const apiV1ErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(API_V1_ERROR_CODES),
    message: z.string(),
    field: z.string().optional(),
    retryAfterSeconds: z.number().int().optional(),
  }),
});
