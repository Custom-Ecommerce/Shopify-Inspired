export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface StorefrontImage {
  url: string;
  alt: string;
}

/** Why a shopper would not see a product. Only a seller's preview ever carries one. */
export type PreviewLabel = "Draft" | "Sample product" | "Removed by admin";

/** A picture of a product's gallery. id is what a variant's imageId names; fixtures may have none. */
export interface StorefrontGalleryImage extends StorefrontImage {
  id?: string;
}

/** A video of a product. Fixtures have none. */
export interface StorefrontProductVideo {
  id: string;
  url: string;
  posterUrl: string | null;
  duration: number | null;
}

export interface StorefrontProductSummary {
  id: string;
  slug: string;
  title: string;
  currency: "PKR";
  /** The from price: the cheapest variant's. */
  price: number;
  /** The compare-at of the cheapest variant, if it has one. */
  compareAtPrice: number | null;
  /** Derived from the variants. */
  stockStatus: StockStatus;
  /** The first variant that can be bought, or the first variant when none can. */
  defaultVariantId: string;
  hasVariants: boolean;
  primaryImage: StorefrontImage | null;
  categories: { id: string; slug: string; name: string }[];
  avgRating: number;
  reviewCount: number;
  /** Sent only in a preview. */
  previewLabel?: PreviewLabel | null;
}

/** A category of the store, as the seller named and ordered it. The backend sends only those holding a published product. */
export interface StorefrontCategory {
  id: string;
  name: string;
  slug: string;
  order: number;
  description: string | null;
  bannerUrl: string | null;
}

export interface StorefrontProductOption {
  name: string;
  values: string[];
}

/** A variant as a shopper sees it. onlyLeft is the only count there is, and only when few remain. Otherwise availability only: stock counts, SKUs and barcodes never reach a storefront. */
export interface StorefrontProductVariant {
  id: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  availability: StockStatus;
  onlyLeft?: number | null;
  optionValues: string[];
  imageId: string | null;
}

/**
 * Detail projection. Mirrors StorefrontProductDetail in apps/storefront/lib/api/schemas.ts
 * field for field, except descriptionHtml, which is added when a theme needs rich text.
 */
export interface StorefrontProductDetail extends StorefrontProductSummary {
  options: StorefrontProductOption[];
  variants: StorefrontProductVariant[];
  description: string | null;
  highlights: string[];
  images: StorefrontGalleryImage[];
  videos?: StorefrontProductVideo[];
  seo: { title: string | null; description: string | null; imageUrl: string | null };
  tags: string[];
  categorySlugs: string[];
  deliveryCharge: number;
  /** Rich description, when the backend sends one. Absent on backends that only send plain text. */
  descriptionHtml?: string | null;
}

export interface CheckoutCustomer {
  customerName: string;
  /** E.164, for example +923001234567. Any Pakistani mobile format is accepted; the server normalises it. */
  phone: string;
  /** Only when it differs from the phone. */
  whatsapp?: string | null;
  address: string;
  city: string;
  email?: string | null;
  note?: string | null;
}

export interface SubmitOrderLine {
  productId: string;
  variantId?: string;
  qty: number;
}

export interface SubmitOrderPayload {
  /** A retry of the same order reuses this key, so the server can return the first result. */
  idempotencyKey: string;
  customer: CheckoutCustomer;
  /** Prices are not sent. The server prices the order itself. */
  lines: SubmitOrderLine[];
  /** One code per order. */
  discountCode?: string | null;
  /** Left out means cash on delivery. */
  paymentMethod?: PaymentMethod;
}

export interface SubmitOrderResult {
  orderId: string;
  /** Server-computed total in PKR. */
  total: number;
  /** Where the shopper pays a card order. */
  checkoutUrl?: string | null;
  /** Lets the tab that placed the order read it back. */
  accessToken?: string | null;
}

export type OrderStatus = "pending" | "confirmed" | "processing" | "dispatched" | "delivered" | "cancelled" | "returned";

export type PaymentMethod = "cod" | "card";

export type PaymentStatus = "unpaid" | "collected" | "paid";

export interface StorefrontOrderItem {
  productId: string;
  variantId: string;
  title: string;
  /** "Default" for a product with no options. */
  variantTitle: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}

/** An order as the shopper sees it on tracking. Mirrors storefrontOrderSchema in @markaz/contracts. */
export interface StorefrontOrder {
  orderId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryCharges: number;
  discount: number;
  /** Sprint 8 (S8-B1): the tax the order was placed with (a snapshot). Absent or 0 when the order has none. Exclusive: part of `total`. Inclusive: already in the prices. */
  taxAmount?: number;
  taxMode?: "exclusive" | "inclusive" | null;
  /** The store's own name for the tax, as it was when the order was placed. */
  taxLabel?: string | null;
  total: number;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  phone: string;
  city: string | null;
  address: string;
  items: StorefrontOrderItem[];
}

/** The first time an order reached each status (EP-02 OB-4). null when it never did. */
export interface StorefrontOrderTrackingDates {
  pending: string | null;
  confirmed: string | null;
  processing: string | null;
  dispatched: string | null;
  delivered: string | null;
  cancelled: string | null;
  returned: string | null;
}

/**
 * Customer tracking (D-069). Only the parcel's journey: no name, phone, address, items, totals or ids. Mirrors
 * storefrontOrderTrackingSchema in @markaz/contracts. A cancelled order has no dates and no courier.
 */
export interface StorefrontOrderTracking {
  orderId: string;
  status: OrderStatus;
  createdAt: string;
  dates: StorefrontOrderTrackingDates;
  /** Only while dispatched or delivered. */
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

export interface OrderLookupInput {
  orderId: string;
  /** E.164, or a local Pakistani mobile format. The server normalises before it compares. */
  phone: string;
}

/** Sprint 5 EP-13.US01.T03: what a shopper may return from a delivered order. Mirrors ReturnEligibility in @markaz/contracts. */
export interface StorefrontReturnableLine {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  unitPrice: number;
  deliveredQuantity: number;
  returnableQuantity: number;
}

export type ReturnIneligibleReasonValue = "not_delivered" | "window_closed" | "returns_off" | "card_order" | "nothing_left";

export interface StorefrontReturnEligibility {
  eligible: boolean;
  reason: ReturnIneligibleReasonValue | null;
  windowDays: number;
  deliveredAt: string | null;
  windowEndsAt: string | null;
  lines: StorefrontReturnableLine[];
}

export type ReturnReasonCode = "damaged" | "wrong_item" | "changed_mind" | "other";

export interface SubmitReturnInput {
  orderId: string;
  phone: string;
  items: Array<{ productId: string; variantId: string; quantity: number }>;
  reasonCode: ReturnReasonCode;
  note?: string | null;
}

export interface StorefrontReturnCreated {
  returnNumber: string;
  status: "requested";
}

/** Sprint 5 EP-21.US01: why a shopper cannot review an order's items. Mirrors REVIEW_INELIGIBLE_REASONS in @markaz/contracts. */
export type ReviewIneligibleReasonValue = "not_delivered" | "nothing_to_review" | "already_reviewed" | "unknown_product";

/** The delivered products of an order that have no review yet. Mirrors ReviewEligibility in @markaz/contracts. */
export interface StorefrontReviewEligibility {
  eligible: boolean;
  reason: ReviewIneligibleReasonValue | null;
  items: Array<{ productId: string; productTitle: string }>;
}

export interface SubmitReviewInput {
  orderId: string;
  phone: string;
  productId: string;
  /** A whole number from 1 to 5. */
  rating: number;
  title?: string | null;
  body: string;
  displayName?: string | null;
}

/** A review is published at once, so the answer is its id and the status approved. */
export interface StorefrontReviewCreated {
  id: string;
  status: "approved";
}

/** One review as the storefront shows it. No customer, order, phone or email. Plain text: render it as text, never as markup. */
export interface StorefrontReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  displayName: string;
  verified: boolean;
  /** ISO date-time. */
  createdAt: string;
  /** The seller's one reply. */
  reply: { text: string; at: string } | null;
}

/** A product's approved reviews, newest first, with the average (one decimal) and the count of ALL its approved reviews. */
export interface StorefrontProductReviews {
  reviews: StorefrontReview[];
  summary: { average: number; count: number };
  page: number;
  totalPages: number;
}

/**
 * Sprint 5 EP-28.US01.T03: a cart the shopper left behind. The checkout sends it once (debounced) after a valid phone and the consent line. Only
 * product ids, variant ids and quantities travel: the server prices the cart itself. The transport adds consent: true, because the call is only
 * made while the consent line is shown.
 */
export interface SaveAbandonedCartInput {
  phone: string;
  email?: string | null;
  lines: Array<{ productId: string; variantId?: string; qty: number }>;
}

/**
 * Why the server refused an order or an order lookup. productId is absent when the server did not
 * name a product. Each code comes from the seller backend's error envelope (see toOrderRejection in remote.ts).
 */
export type OrderRejection =
  | { code: "empty_order" }
  | { code: "invalid_quantity"; productId?: string }
  | { code: "unknown_product"; productId?: string }
  | { code: "product_unavailable"; productId?: string }
  | { code: "variant_required"; productId?: string }
  | { code: "unknown_variant"; productId?: string }
  | { code: "out_of_stock"; productId?: string }
  | { code: "payment_method_unavailable" }
  | { code: "idempotency_conflict" }
  | { code: "rate_limited"; retryAfterSeconds: number | null }
  | { code: "invalid_request"; message: string; field?: string }
  | { code: "store_inactive" }
  | { code: "discount_rejected"; reason: string; message: string }
  | { code: "payment_not_started"; message: string }
  /** Sprint 5 EP-11.US02: the order was refused. The message is neutral and never says the contact is blocked. */
  | { code: "contact_blocked"; message: string };

import type { StorefrontCartQuoteDto, StorefrontCartQuoteIssue, StorefrontCartQuoteLine } from "@markaz/contracts/checkout";
import type { StorefrontArticle, StorefrontArticleList, StorefrontPageLink, StorefrontPageLookup } from "./content-types";

/** Which adapter produced the data. Lets callers and logs say which source they got. */
export type TransportKind = "mock" | "remote";

/**
 * Sprint 7 (S7-B4): a shopper's message to the store (the contact form). `website` is the HONEYPOT: a hidden field no person fills. The server answers success and keeps
 * nothing when it is filled, so a bot learns nothing. Either an email or a phone is needed so the store can answer.
 */
export interface SubmitContactInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  message: string;
  /** The shopper agreed to be answered at the address and number given. Always true when sent. */
  consent: true;
  website?: string | null;
}

export interface OrderConfirmationInput {
  orderNumber: string;
  token: string;
}

export interface CartQuoteLineInput {
  productId: string;
  variantId?: string;
  qty: number;
}

export interface CartQuoteInput {
  lines: CartQuoteLineInput[];
  /** One code per cart. */
  discountCode?: string | null;
  /** Sprint 4 EP-04.US02: the shipping city, when the checkout knows it, so the quote uses the store's rate for it. */
  city?: string | null;
}

/** Why a cart line cannot be bought as it stands. */
export type CartQuoteIssue = StorefrontCartQuoteIssue;

export type CartQuoteLine = StorefrontCartQuoteLine;

/** The server's priced view of a cart, as the shared contract defines it. Totals cover only the lines that can be bought. */
export type CartQuote = StorefrontCartQuoteDto;

/**
 * The order-side operations. A browser reaches them through the same-origin BFF, and the storefront server reaches
 * them through the seller backend. The same error mapping applies to both.
 */
export interface OrderTransport {
  /** Prices a cart without moving stock. Refusals and unknown products are reported per line, not thrown. */
  quoteCart(input: CartQuoteInput): Promise<CartQuote>;
  /** Rejects with OrderRejectedError when the server refuses the order. Any other error means unavailable. */
  submitOrder(payload: SubmitOrderPayload): Promise<SubmitOrderResult>;
  /** Resolves to null when no order matches both the id and the phone. Refusals reject with OrderRejectedError. */
  lookupOrder(input: OrderLookupInput): Promise<StorefrontOrder | null>;
  /** The tab that placed the order reading it back with its token. null for a bad or expired token or an unknown order. */
  confirmOrder(input: OrderConfirmationInput): Promise<StorefrontOrder | null>;
  /** Customer tracking (D-069): the parcel's journey only. null when no order matches both the id and the phone. */
  trackOrder(input: OrderLookupInput): Promise<StorefrontOrderTracking | null>;
  /** Sprint 5 EP-13: what may still be returned from this order, and the state of the window. null when no order matches both the number and the phone. */
  getReturnEligibility(input: OrderLookupInput): Promise<StorefrontReturnEligibility | null>;
  /** Sprint 5 EP-13: asks for a return. null when no order matches. Rejects with ReturnRefusedError when it cannot be requested. */
  submitReturn(input: SubmitReturnInput): Promise<StorefrontReturnCreated | null>;
  /** Sprint 5 EP-21: the delivered products of this order that have no review yet. null when no order matches both the number and the phone. */
  getReviewEligibility(input: OrderLookupInput): Promise<StorefrontReviewEligibility | null>;
  /** Sprint 5 EP-21: reviews a product of a delivered order, published at once. null when no order matches. Rejects with ReviewRefusedError when it cannot be reviewed. */
  submitReview(input: SubmitReviewInput): Promise<StorefrontReviewCreated | null>;
  /** Sprint 5 EP-21: a product's approved reviews, newest first, one page at a time (10 per page). A product with none has an empty list and a count of 0. */
  getProductReviews(slug: string, page?: number): Promise<StorefrontProductReviews>;
  /** Sprint 5 EP-28: keeps the shopper's cart for the seller to follow up (WhatsApp first). Resolves when saved; callers ignore failures. */
  saveAbandonedCart(input: SaveAbandonedCartInput): Promise<void>;
  /** Sprint 7 (S7-B4): sends the shopper's message to the store. Resolves ONLY once the store has kept it; refusals reject with OrderRejectedError (invalid_request with its field, rate_limited, store_inactive). Optional so existing transports keep working. */
  submitContact?(input: SubmitContactInput): Promise<void>;
  /** The Live products among these ids, at most 48 per call. An id with no Live product is simply absent from the answer. */
  getProductsByIds(ids: string[]): Promise<StorefrontProductSummary[]>;
}

/**
 * The server-side boundary. Each adapter is bound to one data source: mock to the fixtures, remote to one store
 * on the seller backend.
 */
export type ProductSort = "newest" | "price_asc" | "price_desc" | "rating";

/** A product listing request. Every field is optional; an empty query is the first default page. */
export interface ProductQuery {
  /** A category slug. */
  category?: string;
  q?: string;
  sort?: ProductSort;
  page?: number;
  limit?: number;
}

export interface ProductListPage {
  items: StorefrontProductSummary[];
  page: number;
  totalPages: number;
}

export interface StorefrontTransport extends OrderTransport {
  readonly kind: TransportKind;
  getProducts(): Promise<StorefrontProductSummary[]>;
  /** The store's categories, in the seller's order. */
  listCategories(): Promise<StorefrontCategory[]>;
  /** Paged, filtered listing. Optional so existing transports (and test doubles) keep working. */
  listProducts?(query?: ProductQuery): Promise<ProductListPage>;
  /** Resolves to null when no product has this slug. The route turns that into a 404. */
  getProduct(slug: string): Promise<StorefrontProductDetail | null>;
  /** Sprint 7 (S7-B3): the published blog articles, newest first, one page at a time. Optional so existing transports (and test doubles) keep working: a store without it has no blog. */
  listArticles?(page?: number, limit?: number): Promise<StorefrontArticleList>;
  /** One published article by slug, its text as the safe tree. null for a draft, an unknown slug or another type. */
  getArticle?(slug: string): Promise<StorefrontArticle | null>;
  /** The published static pages in footer order (address and title only). */
  listPages?(): Promise<StorefrontPageLink[]>;
  /** One static page by slug: found, a draft (404, no default copy) or none (the default copy may be used). */
  getPage?(slug: string): Promise<StorefrontPageLookup>;
}
/* @theme-integration-patch:types */
