import { z } from 'zod';
import { objectIdSchema } from './object-id';

/*
 * Sprint 8 (S8-B6, D-118): anonymous first-party counters. An event says WHICH STORE, WHAT HAPPENED and, for a product view, WHICH PRODUCT. Nothing else:
 * no cookie, no visitor id, no IP, no personal data. Every object is strict, so a field added by mistake is refused.
 */

export const STOREFRONT_EVENTS = ['page_view', 'product_view', 'add_to_cart', 'checkout_start'] as const;
export type StorefrontEvent = (typeof STOREFRONT_EVENTS)[number];

/** Counters are removed by MongoDB this many days after their day. */
export const STAT_RETENTION_DAYS = 400;
/** The most different products one store gets a per-product counter for in one day. */
export const PRODUCT_STAT_SLUGS_PER_DAY = 500;
export const STAT_PRODUCT_SLUG_MAX = 200;

const productSlug = z.string().min(1).max(STAT_PRODUCT_SLUG_MAX);

/** What the storefront's own browser code sends its BFF: the store comes from the host, never from the body. */
export const storefrontBrowserEventSchema = z
  .strictObject({ event: z.enum(STOREFRONT_EVENTS), productSlug: productSlug.optional() })
  .superRefine((value, context) => {
    if (value.event === 'product_view' && value.productSlug === undefined) context.addIssue({ code: 'custom', path: ['productSlug'], message: 'a product view names the product' });
    if (value.event !== 'product_view' && value.productSlug !== undefined) context.addIssue({ code: 'custom', path: ['productSlug'], message: 'only a product view names a product' });
  });
export type StorefrontBrowserEvent = z.output<typeof storefrontBrowserEventSchema>;

/** POST /api/storefront/v1/events: what the storefront server sends the seller backend. */
export const storefrontEventRequestSchema = z
  .strictObject({ store: objectIdSchema, event: z.enum(STOREFRONT_EVENTS), productSlug: productSlug.optional() })
  .superRefine((value, context) => {
    if (value.event === 'product_view' && value.productSlug === undefined) context.addIssue({ code: 'custom', path: ['productSlug'], message: 'a product view names the product' });
    if (value.event !== 'product_view' && value.productSlug !== undefined) context.addIssue({ code: 'custom', path: ['productSlug'], message: 'only a product view names a product' });
  });
export type StorefrontEventRequest = z.output<typeof storefrontEventRequestSchema>;

const count = z.number().int().min(0);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One day of a store's counters, as the analytics read will answer it (S8-B7). */
export const dailyStatSchema = z.strictObject({ day, visits: count, productViews: count, addToCart: count, checkoutStarts: count, orders: count });
export type DailyStatView = z.output<typeof dailyStatSchema>;

/** Views of one product over a range. */
export const productViewsSchema = z.strictObject({ productSlug: z.string(), views: count });
export type ProductViews = z.output<typeof productViewsSchema>;
