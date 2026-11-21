import { z } from 'zod';
import { storefrontCheckoutCustomerSchema, STOREFRONT_ORDER_MAX_LINES, storefrontOrderLineRequestSchema } from './checkout';

/*
 * Sprint 5 EP-28 (D-107): abandoned carts, WhatsApp first. A cart is kept only when the shopper typed a VALID phone and was shown the
 * consent line; it lists what the server prices from the product ids (never what the browser says), lives 7 days, and the seller reaches the
 * shopper with a wa.me link. An automatic email is optional and off by default.
 */

export const ABANDONED_CART_STATUSES = ['open', 'contacted', 'recovered', 'expired'] as const;
export type AbandonedCartStatus = (typeof ABANDONED_CART_STATUSES)[number];

/** A cart keeps at most this many lines (the same cap as an order). */
export const ABANDONED_CART_ITEMS_MAX = STOREFRONT_ORDER_MAX_LINES;
/** An untouched cart is deleted this many days after the shopper last had it open (a TTL index on expiresAt). */
export const ABANDONED_CART_TTL_DAYS = 7;
/** The optional automatic email goes out this long after the last activity, once. */
export const ABANDONED_CART_EMAIL_DELAY_MS = 2 * 60 * 60 * 1000;
/** The seller's list never shows more than this many carts per page. */
export const ABANDONED_CART_PAGE_MAX = 50;
export const ABANDONED_CART_PAGE_DEFAULT = 20;

/** The words the checkout shows next to the phone field. The consent the request carries is for exactly this line. */
export const ABANDONED_CART_CONSENT_LINE = 'We may message you about this cart';

/** Error codes of the seller's abandoned cart routes. */
export const ABANDONED_CART_NOT_FOUND = 'ABANDONED_CART_NOT_FOUND';
export const ABANDONED_CART_STATUS_CHANGED = 'ABANDONED_CART_STATUS_CHANGED';

/**
 * PUT /api/storefront/v1/stores/:id/abandoned-cart. The phone is the checkout's phone rule (output: +923xxxxxxxxx), the email is optional, and
 * consent must be literally true. The lines are product ids and quantities only: a price or a total in the body is dropped (not trusted).
 */
export const abandonedCartRequestSchema = z.object({
  phone: storefrontCheckoutCustomerSchema.shape.phone,
  email: storefrontCheckoutCustomerSchema.shape.email,
  consent: z.literal(true, { error: 'Consent is needed to keep this cart.' }),
  lines: z.array(storefrontOrderLineRequestSchema).min(1, 'The cart is empty.').max(ABANDONED_CART_ITEMS_MAX),
});

export type AbandonedCartRequest = z.output<typeof abandonedCartRequestSchema>;

/** The seller's list filters. */
export const abandonedCartListQuerySchema = z
  .object({
    status: z.enum(['open', 'contacted', 'recovered']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(ABANDONED_CART_PAGE_MAX).default(ABANDONED_CART_PAGE_DEFAULT),
  })
  .strict();

export type AbandonedCartListQuery = z.output<typeof abandonedCartListQuerySchema>;

/** One line of a cart as the seller reads it: the name, quantity and price as the server priced them. */
export interface AbandonedCartItemView {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  unitPrice: number;
}

/** A cart as the seller reads it. The phone is shown (it is the point: the seller calls or messages it); nothing else personal exists. */
export interface SellerAbandonedCart {
  id: string;
  phone: string;
  email: string | null;
  items: AbandonedCartItemView[];
  /** The value of the items in whole rupees, priced by the server (delivery not included). */
  total: number;
  status: AbandonedCartStatus;
  lastSeenAt: string;
  contactedAt: string | null;
  recoveredOrder: string | null;
  createdAt: string;
}

export interface AbandonedCartList {
  docs: SellerAbandonedCart[];
  page: number;
  limit: number;
  totalDocs: number;
  totalPages: number;
  /** Open carts of the store, whatever the filter (the dashboard count). */
  openCount: number;
}

/** What the public PUT answers. Nothing about the cart comes back. */
export const abandonedCartSavedSchema = z.object({ saved: z.literal(true) });


/** PATCH /api/stores/:id/abandoned-carts/:cartId: the one move a seller makes, an open cart becomes contacted. Strict. */
export const abandonedCartContactedRequestSchema = z.object({ status: z.literal('contacted') }).strict();
