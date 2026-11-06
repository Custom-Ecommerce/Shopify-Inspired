import { z } from "zod";

/**
 * Zod schemas for the seller storefront API (`/api/storefront/v1`, report §4.4).
 *
 * These mirror the backend DTO projections field for field. Parsing is strict
 * about shape and types (a missing or mistyped field fails the whole response)
 * but tolerant of EXTRA keys, which are stripped. That lets the seller add a
 * field without taking the storefront down during a staggered deploy.
 *
 * Pure module with no I/O: types derived from here may be imported anywhere.
 */

/* ------------------------------ primitives ------------------------------ */

/** Cloudinary URLs are absolute, but Payload-local media can be relative. */
const mediaUrl = z.string().min(1);
const nullableText = z.string().nullable();
/** Shoppers only ever see whole rupees (D-004). */
const price = z.number().int().nonnegative();

export const StoreStatus = z.enum(["active", "pending", "suspended", "archived"]);
export type StoreStatus = z.infer<typeof StoreStatus>;

export const StorefrontImage = z.object({
  url: mediaUrl,
  alt: z.string(),
});
export type StorefrontImage = z.infer<typeof StorefrontImage>;

/* -------------------------------- store --------------------------------- */

export const StorefrontStore = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  internalHandle: z.string().nullable(),
  name: z.string(),
  status: StoreStatus,
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
    currency: z.literal("PKR"),
    codEnabled: z.boolean(),
    cardEnabled: z.boolean(),
    deliveryRate: price,
    freeDeliveryThreshold: price.nullable(),
    whatsappNumber: nullableText,
  }),
  features: z.object({
    socialProofEnabled: z.boolean(),
  }),
  theme: z.object({
    activeTheme: nullableText,
  }),
});
export type StorefrontStore = z.infer<typeof StorefrontStore>;

/**
 * What the backend returns for a store that exists but is not active: its
 * state and nothing else. `active` is deliberately excluded, so a malformed
 * active-store DTO can never be mistaken for this shape.
 */
export const StorefrontStoreStatusOnly = z.object({
  status: z.enum(["pending", "suspended", "archived"]),
});
export type StorefrontStoreStatusOnly = z.infer<typeof StorefrontStoreStatusOnly>;

/* ------------------------------- category ------------------------------- */

export const StorefrontCategory = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string().min(1),
  order: z.number(),
  description: nullableText,
  bannerUrl: z.string().nullable(),
});
export type StorefrontCategory = z.infer<typeof StorefrontCategory>;

/* ------------------------------- products ------------------------------- */

export const StockStatus = z.enum(["in_stock", "low_stock", "out_of_stock"]);
export type StockStatus = z.infer<typeof StockStatus>;

export const StorefrontProductSummary = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  currency: z.literal("PKR"),
  /** The from price: the cheapest variant's. */
  price,
  /** The compare-at of the cheapest variant, if it has one. */
  compareAtPrice: price.nullable(),
  /** Derived from the variants. */
  stockStatus: StockStatus,
  defaultVariantId: z.string().min(1),
  hasVariants: z.boolean(),
  primaryImage: StorefrontImage.nullable(),
  categories: z.array(
    z.object({
      id: z.string().min(1),
      slug: z.string().min(1),
      name: z.string(),
    }),
  ),
  avgRating: z.number().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
});
export type StorefrontProductSummary = z.infer<typeof StorefrontProductSummary>;

export const StorefrontProductVariant = z.object({
  id: z.string().min(1),
  title: z.string(),
  price,
  compareAtPrice: price.nullable(),
  availability: StockStatus,
  optionValues: z.array(z.string()),
  imageId: z.string().nullable(),
});
export type StorefrontProductVariant = z.infer<typeof StorefrontProductVariant>;

export const StorefrontProductDetail = StorefrontProductSummary.extend({
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  variants: z.array(StorefrontProductVariant).min(1),
  /** Plain text, as the seller wrote it. */
  description: nullableText,
  /** HTML-escaped with newlines as `<br>`; the only markup it contains. */
  descriptionHtml: nullableText,
  highlights: z.array(z.string()),
  images: z.array(StorefrontImage),
  seo: z.object({
    title: nullableText,
    description: nullableText,
    imageUrl: z.string().nullable(),
  }),
  tags: z.array(z.string()),
  categorySlugs: z.array(z.string()),
  deliveryCharge: price,
});
export type StorefrontProductDetail = z.infer<typeof StorefrontProductDetail>;

/* ---------------------------- response envelopes ------------------------- */

/** `{ data }` success envelope. */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

/** `{ error: { code, message }, ...extra }` failure envelope. Best-effort parse. */
export const StorefrontErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
  }),
  status: z.string().optional(),
});
export type StorefrontErrorEnvelope = z.infer<typeof StorefrontErrorEnvelope>;

export const StoreByKeyResponse = envelope(z.union([StorefrontStore, StorefrontStoreStatusOnly])).extend({
  /** True only when the backend accepted the preview credential for this exact store. */
  preview: z.boolean().optional(),
});
export const CategoriesResponse = envelope(z.array(StorefrontCategory));
export const ProductDetailResponse = envelope(StorefrontProductDetail);

export const ProductListResponse = z.object({
  data: z.array(StorefrontProductSummary),
  page: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  totalDocs: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type ProductListResponse = z.infer<typeof ProductListResponse>;
