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
  | { code: "payment_not_started"; message: string };

import type { StorefrontCartQuoteDto, StorefrontCartQuoteIssue, StorefrontCartQuoteLine } from "@markaz/contracts/checkout";

/** Which adapter produced the data. Lets callers and logs say which source they got. */
export type TransportKind = "mock" | "remote";

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
}
/* @theme-integration-patch:types */
