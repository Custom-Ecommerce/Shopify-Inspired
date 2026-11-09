import { z } from 'zod';
import { STOCK_STATUSES } from './stock-status';
import { STOREFRONT_ORDER_MAX_LINES, storefrontCheckoutCustomerSchema, storefrontDiscountCodeSchema, storefrontOrderLineRequestSchema } from './checkout';

/**
 * Storefront wire contract (Track B). The seller backend serves these shapes under
 * /api/storefront/v1 and the storefront parses the same shapes, so both sides compile against one
 * definition (blueprint finding F6). StorefrontProductSummary mirrors apps/storefront/lib/api/schemas.ts
 * and packages/storefront-data/src/transport/wire.ts field for field.
 */

export const STOREFRONT_API_PREFIX = '/api/storefront/v1';

/** Catalog limits. The backend clamps numeric params into these ranges. */
export const STOREFRONT_PRODUCTS_DEFAULT_LIMIT = 24;
export const STOREFRONT_PRODUCTS_MAX_LIMIT = 48;
export const STOREFRONT_PRODUCTS_MAX_PAGE = 1000;
export const STOREFRONT_SEARCH_MAX_LENGTH = 80;

export const STOREFRONT_PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc', 'rating'] as const;
export type StorefrontProductSort = (typeof STOREFRONT_PRODUCT_SORTS)[number];

/** How GET /stores/by-key/:key interprets the key. Omitted means: a dot makes it a domain, else a slug. */
export const STOREFRONT_STORE_LOOKUPS = ['slug', 'handle', 'domain'] as const;
export type StorefrontStoreLookup = (typeof STOREFRONT_STORE_LOOKUPS)[number];

/** Shapes a key may take. Anything else cannot be a store, so no query is made for it. */
export const STOREFRONT_SLUG_PATTERN = /^[a-z0-9-]{3,64}$/;
export const STOREFRONT_DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const STOREFRONT_CATEGORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const STOREFRONT_ERROR_CODES = [
  'STORE_NOT_FOUND',
  'STORE_NOT_ACTIVE',
  'PRODUCT_NOT_FOUND',
  'INVALID_REQUEST',
  'STOREFRONT_UNAVAILABLE',
  'INTERNAL_ERROR',
  // Part 7: checkout and order tracking.
  'ORDER_NOT_FOUND',
  'EMPTY_ORDER',
  'INVALID_QUANTITY',
  'UNKNOWN_PRODUCT',
  'OUT_OF_STOCK',
  'PAYMENT_METHOD_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  // Variants.
  'VARIANT_REQUIRED',
  'UNKNOWN_VARIANT',
  'PRODUCT_UNAVAILABLE',
  // Seller preview: an order sent from a preview is never placed.
  'PREVIEW_ORDER_BLOCKED',
  // Discounts (D-080).
  'DISCOUNT_REJECTED',
  'DISCOUNT_USED_UP',
  // Card payment (D-082).
  'PAYMENT_NOT_STARTED',
] as const;
export type StorefrontErrorCode = (typeof STOREFRONT_ERROR_CODES)[number];

/** Shoppers only ever see whole rupees (D-004). */
const price = z.number().int().nonnegative();
const nullableText = z.string().nullable();

export const storefrontImageSchema = z.object({
  url: z.string().min(1),
  alt: z.string(),
});

/** A picture of a product's gallery. The id is what a variant's imageId names, so a selector can switch to it. */
export const storefrontGalleryImageSchema = storefrontImageSchema.extend({ id: z.string().min(1) });

/** A video of a product. duration is in seconds, null if it was never measured. */
export const storefrontVideoSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  posterUrl: z.string().nullable(),
  duration: z.number().nonnegative().nullable(),
});

export const storefrontStoreSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  internalHandle: z.string().nullable(),
  name: z.string(),
  status: z.enum(['active', 'pending', 'suspended', 'archived']),
  isThemeDemo: z.boolean(),
  branding: z.object({
    logoUrl: z.string().nullable(),
    announcementText: nullableText,
    heroBanners: z.array(
      z.object({
        imageUrl: z.string().nullable(),
        heading: nullableText,
        subheading: nullableText,
        linkUrl: nullableText,
      }),
    ),
  }),
  seo: z.object({
    title: nullableText,
    description: nullableText,
    imageUrl: z.string().nullable(),
  }),
  commerce: z.object({
    currency: z.literal('PKR'),
    codEnabled: z.boolean(),
    cardEnabled: z.boolean(),
    deliveryRate: price,
    freeDeliveryThreshold: price.nullable(),
    whatsappNumber: nullableText,
  }),
  features: z.object({ socialProofEnabled: z.boolean() }),
  theme: z.object({ activeTheme: nullableText }),
});

/** What the backend returns for a store that exists but is not active: its state and nothing else. */
export const storefrontStoreStatusOnlySchema = z.object({
  status: z.enum(['pending', 'suspended', 'archived']),
});

export const storefrontStoreByKeyResponseSchema = z.object({
  data: z.union([storefrontStoreSchema, storefrontStoreStatusOnlySchema]),
  /** True only when the request's preview credential was accepted for this store. Then a pending store has a full body. */
  preview: z.boolean().optional(),
});

export const storefrontProductSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  currency: z.literal('PKR'),
  /** The from price: the cheapest variant's. */
  price,
  /** The compare-at of the cheapest variant, if it has one. */
  compareAtPrice: price.nullable(),
  /** Derived from the variants. */
  stockStatus: z.enum(STOCK_STATUSES),
  /** The first variant that can be bought, or the first variant when none can. */
  defaultVariantId: z.string().min(1),
  hasVariants: z.boolean(),
  primaryImage: storefrontImageSchema.nullable(),
  categories: z.array(z.object({ id: z.string().min(1), slug: z.string().min(1), name: z.string() })),
  avgRating: z.number().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  /** Sent only in a seller's preview: why a shopper would not see this product. Live responses never have this key. */
  previewLabel: z.enum(['Draft', 'Sample product', 'Removed by admin']).nullable().optional(),
});

/** A store category as a shopper navigates it. Only categories that hold a published product are listed. */
export const storefrontCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string().min(1),
  order: z.number(),
  description: z.string().nullable(),
  bannerUrl: z.string().nullable(),
});

export const storefrontCategoryListResponseSchema = z.object({ data: z.array(storefrontCategorySchema) });

export const storefrontProductListResponseSchema = z.object({
  data: z.array(storefrontProductSummarySchema),
  page: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  totalDocs: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

export const storefrontErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
  status: z.string().optional(),
});

export type StorefrontStoreDto = z.infer<typeof storefrontStoreSchema>;
export type StorefrontProductSummaryDto = z.infer<typeof storefrontProductSummarySchema>;
export type StorefrontProductListResponse = z.infer<typeof storefrontProductListResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * Part 7: product detail, checkout, and order tracking.
 *
 * The detail shape mirrors WireProductDetail in @markaz/storefront-data. The order request carries NO
 * prices and NO totals: the server prices the order itself. Unknown keys are stripped by the schema, so a
 * client that sends a price is ignored rather than trusted.
 * ---------------------------------------------------------------------------------------------- */

/** A product slug is one path segment: no whitespace, no slashes. Anything else cannot be a product. */
export const STOREFRONT_PRODUCT_SLUG_PATTERN = /^[^\s/\\]{1,200}$/;
export const STOREFRONT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const STOREFRONT_PAYMENT_METHODS = ['cod', 'card'] as const;
export type StorefrontPaymentMethod = (typeof STOREFRONT_PAYMENT_METHODS)[number];

export const STOREFRONT_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'dispatched',
  'delivered',
  'cancelled',
  'returned',
] as const;
export type StorefrontOrderStatus = (typeof STOREFRONT_ORDER_STATUSES)[number];

export const storefrontProductOptionSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
});

/** A variant as a shopper sees it. No sku, no barcode, no stock count: availability is all a shopper needs. */
export const storefrontProductVariantSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  price,
  compareAtPrice: price.nullable(),
  availability: z.enum(STOCK_STATUSES),
  optionValues: z.array(z.string()),
  imageId: z.string().nullable(),
});

export const storefrontProductDetailSchema = storefrontProductSummarySchema.extend({
  options: z.array(storefrontProductOptionSchema),
  variants: z.array(storefrontProductVariantSchema).min(1),
  description: nullableText,
  highlights: z.array(z.string()),
  images: z.array(storefrontGalleryImageSchema),
  videos: z.array(storefrontVideoSchema),
  seo: z.object({
    title: nullableText,
    description: nullableText,
    imageUrl: z.string().nullable(),
  }),
  tags: z.array(z.string()),
  categorySlugs: z.array(z.string()),
  deliveryCharge: price,
});

export const storefrontProductDetailResponseSchema = z.object({ data: storefrontProductDetailSchema });

export const storefrontCreateOrderRequestSchema = z.object({
  /** Also accepted as the Idempotency-Key header, which wins when both are present. */
  idempotencyKey: z.string().regex(STOREFRONT_IDEMPOTENCY_KEY_PATTERN).optional(),
  customer: storefrontCheckoutCustomerSchema,
  lines: z.array(storefrontOrderLineRequestSchema).max(STOREFRONT_ORDER_MAX_LINES),
  paymentMethod: z.enum(STOREFRONT_PAYMENT_METHODS).optional(),
  /** One code per order. Empty counts as none. */
  discountCode: storefrontDiscountCodeSchema.nullish(),
});

export const storefrontOrderCreatedSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(STOREFRONT_ORDER_STATUSES),
  paymentMethod: z.enum(STOREFRONT_PAYMENT_METHODS),
  subtotal: price,
  deliveryCharges: price,
  /** Rupees taken off the subtotal by a code. */
  discount: price.default(0),
  total: price,
  createdAt: z.string().min(1),
});

/** Superset of the provisional WireOrderCreated ({ data: { orderId, total } }) the storefront already parses. */
export const storefrontOrderCreatedResponseSchema = z.object({
  data: storefrontOrderCreatedSchema.extend({
    /** Where the shopper pays a card order. Null for cash on delivery, or when nothing is left to pay. */
    checkoutUrl: z.string().min(1).nullable().default(null),
  }),
});

export const storefrontOrderLookupRequestSchema = z.object({
  orderId: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(1).max(32),
});

export const storefrontOrderItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  title: z.string(),
  variantTitle: z.string(),
  unitPrice: price,
  qty: z.number().int().min(1),
  lineTotal: price,
});

export const storefrontOrderSchema = storefrontOrderCreatedSchema.extend({
  customerName: z.string(),
  phone: z.string(),
  city: nullableText,
  address: z.string(),
  discountCode: nullableText.default(null),
  paymentStatus: z.enum(['unpaid', 'collected', 'paid']).default('unpaid'),
  items: z.array(storefrontOrderItemSchema),
  updatedAt: z.string().min(1),
});

export const storefrontOrderLookupResponseSchema = z.object({ data: storefrontOrderSchema });

// EP-02 OB-4 (D-069): customer tracking. POST /orders/track with the same { orderId, phone } body as the lookup. Only what a
// parcel's journey needs: no name, phone, address, city, items, totals, notes, cancel reason, payment or internal ids.
// Strict, so a field added on the server by mistake fails the parse instead of reaching a shopper.

const trackingDate = z.string().min(1).nullable();

/** The first time the order reached each status. null when it never did (or when it is unknown). */
export const storefrontOrderTrackingDatesSchema = z
  .object({
    pending: trackingDate,
    confirmed: trackingDate,
    processing: trackingDate,
    dispatched: trackingDate,
    delivered: trackingDate,
    cancelled: trackingDate,
    returned: trackingDate,
  })
  .strict();

export const storefrontOrderTrackingSchema = z
  .object({
    orderId: z.string().min(1),
    status: z.enum(STOREFRONT_ORDER_STATUSES),
    createdAt: z.string().min(1),
    dates: storefrontOrderTrackingDatesSchema,
    /** Only while dispatched or delivered; null otherwise. */
    courier: z.string().nullable(),
    trackingNumber: z.string().nullable(),
    trackingUrl: z.string().nullable(),
  })
  .strict();

export const storefrontOrderTrackingResponseSchema = z.object({ data: storefrontOrderTrackingSchema }).strict();

export type StorefrontOrderTrackingDates = z.output<typeof storefrontOrderTrackingDatesSchema>;
export type StorefrontOrderTracking = z.output<typeof storefrontOrderTrackingSchema>;

export type StorefrontProductDetailDto = z.infer<typeof storefrontProductDetailSchema>;
export type StorefrontCreateOrderRequest = z.infer<typeof storefrontCreateOrderRequestSchema>;
export type StorefrontOrderCreatedDto = z.infer<typeof storefrontOrderCreatedSchema>;
export type StorefrontOrderDto = z.infer<typeof storefrontOrderSchema>;
