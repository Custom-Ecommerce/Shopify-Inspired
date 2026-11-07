import { z } from "zod";

/*
 * Response shapes the remote transport and the browser BFF client accept. They mirror apps/storefront/lib/api/schemas.ts
 * and the storefront contracts in @markaz/contracts field for field. Zod strips keys it does not know, so a backend that
 * adds fields does not break existing storefronts. Move these into @markaz/contracts once Track B owns the contract.
 */

const price = z.number().int().nonnegative();
const nullableText = z.string().nullable();
const stockStatus = z.enum(["in_stock", "low_stock", "out_of_stock"]);

export const WireImage = z.object({
  url: z.string().min(1),
  alt: z.string(),
});

export const WireGalleryImage = WireImage.extend({
  id: z.string().min(1).optional(),
});

export const WireVideo = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  posterUrl: z.string().nullable(),
  duration: z.number().nonnegative().nullable(),
});

export const WireCategoryList = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      slug: z.string().min(1),
      order: z.number(),
      description: nullableText,
      bannerUrl: nullableText,
    }),
  ),
});

export const WireProductSummary = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  currency: z.literal("PKR"),
  price,
  compareAtPrice: price.nullable(),
  stockStatus,
  defaultVariantId: z.string().min(1),
  hasVariants: z.boolean(),
  primaryImage: WireImage.nullable(),
  categories: z.array(
    z.object({
      id: z.string().min(1),
      slug: z.string().min(1),
      name: z.string(),
    }),
  ),
  avgRating: z.number().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  previewLabel: z.enum(["Draft", "Sample product", "Removed by admin"]).nullable().optional(),
});

export const WireProductOption = z.object({
  name: z.string(),
  values: z.array(z.string()),
});

export const WireProductVariant = z.object({
  id: z.string().min(1),
  title: z.string(),
  price,
  compareAtPrice: price.nullable(),
  availability: stockStatus,
  optionValues: z.array(z.string()),
  imageId: z.string().nullable(),
});

export const WireProductDetail = WireProductSummary.extend({
  options: z.array(WireProductOption),
  variants: z.array(WireProductVariant).min(1),
  description: nullableText,
  highlights: z.array(z.string()),
  images: z.array(WireGalleryImage),
  videos: z.array(WireVideo).default([]),
  seo: z.object({
    title: nullableText,
    description: nullableText,
    imageUrl: z.string().nullable(),
  }),
  tags: z.array(z.string()),
  categorySlugs: z.array(z.string()),
  deliveryCharge: price,
  descriptionHtml: nullableText.optional(),
});

export const WireProductList = z.object({
  data: z.array(WireProductSummary),
  page: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  totalDocs: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

export const WireProductDetailEnvelope = z.object({
  data: WireProductDetail,
});

/** A created order. The storefront needs only the id and the total here; zod strips the other fields. */
export const WireOrderCreated = z.object({
  data: z.object({
    orderId: z.string().min(1),
    total: z.number().nonnegative(),
  }),
});

const orderStatus = z.enum(["pending", "confirmed", "processing", "dispatched", "delivered", "cancelled", "returned"]);
const paymentMethod = z.enum(["cod", "card"]);

export const WireOrderItem = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  title: z.string(),
  variantTitle: z.string(),
  unitPrice: price,
  qty: z.number().int().min(1),
  lineTotal: price,
});

/** An order on the lookup response. Mirrors storefrontOrderSchema in @markaz/contracts. */
export const WireOrder = z.object({
  orderId: z.string().min(1),
  status: orderStatus,
  paymentMethod,
  subtotal: price,
  deliveryCharges: price,
  total: price,
  createdAt: z.string().min(1),
  customerName: z.string(),
  phone: z.string(),
  city: nullableText,
  address: z.string(),
  items: z.array(WireOrderItem),
  updatedAt: z.string().min(1),
});

export const WireOrderLookup = z.object({
  data: WireOrder,
});

const quoteIssue = z.enum(["unknown_product", "product_unavailable", "unknown_variant", "out_of_stock", "insufficient_stock"]);

export const WireCartQuoteLine = z.object({
  productId: z.string().min(1),
  variantId: nullableText,
  title: nullableText,
  variantTitle: nullableText,
  unitPrice: price.nullable(),
  qty: z.number().int().min(1),
  lineTotal: price.nullable(),
  issue: quoteIssue.nullable(),
  availableQty: z.number().int().nonnegative().nullable(),
});

/** A priced cart. Mirrors storefrontCartQuoteSchema in @markaz/contracts. */
export const WireCartQuote = z.object({
  lines: z.array(WireCartQuoteLine),
  subtotal: price,
  deliveryCharges: price,
  total: price,
  canCheckout: z.boolean(),
});

export const WireCartQuoteEnvelope = z.object({
  data: WireCartQuote,
});

export const WireErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
  }),
});

/**
 * A refused request. The backend puts productId and retryAfterSeconds beside `error`, not inside it
 * (see StorefrontHttpError.extra in the seller backend), so they are read from the top level.
 */
export const WireRefusal = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
  }),
  productId: z.string().optional(),
  retryAfterSeconds: z.number().optional(),
});
/* @theme-integration-patch:wire */
