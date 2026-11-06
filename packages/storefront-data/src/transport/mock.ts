import type {
  CartQuote,
  CartQuoteInput,
  CartQuoteLine,
  OrderLookupInput,
  StorefrontOrder,
  StorefrontOrderItem,
  StorefrontProductDetail,
  StorefrontProductSummary,
  StorefrontProductVariant,
  StorefrontTransport,
  SubmitOrderPayload,
  SubmitOrderResult,
} from "./types";
import { OrderRejectedError } from "./errors";
import type { ProductListPage, ProductQuery } from "./types";
import { normalizePhoneE164 } from "@markaz/platform-kit/phone";

// Hardcoded dummy catalogue. Includes edge cases (no image, discount, out of stock,
// low stock, no reviews, free delivery, very long title) so themes are exercised from day one.
const NO_SEO = { title: null, description: null, imageUrl: null };

/** A product with no options, written the short way: the Default variant is filled in by mockProduct. */
export type MockProductInput = Omit<StorefrontProductDetail, "defaultVariantId" | "hasVariants" | "options" | "variants">;

export function mockProduct(input: MockProductInput): StorefrontProductDetail {
  const variantId = input.id + "_default";
  return {
    ...input,
    defaultVariantId: variantId,
    hasVariants: false,
    options: [],
    variants: [
      {
        id: variantId,
        title: "Default",
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        availability: input.stockStatus,
        optionValues: [],
        imageId: null,
      },
    ],
  };
}

const MOCK_PRODUCT_INPUTS: MockProductInput[] = [
  {
    id: "prod_tee_001",
    slug: "classic-cotton-tee",
    title: "Classic Cotton Tee",
    currency: "PKR",
    price: 1299,
    compareAtPrice: 1599,
    stockStatus: "in_stock",
    primaryImage: { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", alt: "Classic cotton tee" },
    categories: [{ id: "cat_apparel", slug: "apparel", name: "Apparel" }],
    avgRating: 4.6,
    reviewCount: 128,
    description: "A soft, breathable everyday tee in 100% combed cotton with a relaxed fit.",
    highlights: ["100% combed cotton", "Relaxed fit", "Machine washable"],
    images: [
      { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", alt: "Classic cotton tee, front" },
      { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", alt: "Classic cotton tee, back" },
    ],
    seo: NO_SEO,
    tags: ["tee", "cotton", "everyday"],
    categorySlugs: ["apparel"],
    deliveryCharge: 150,
  },
  {
    id: "prod_kurta_002",
    slug: "embroidered-lawn-kurta",
    title: "Embroidered Lawn Kurta",
    currency: "PKR",
    price: 3450,
    compareAtPrice: null,
    stockStatus: "low_stock",
    primaryImage: null,
    categories: [{ id: "cat_apparel", slug: "apparel", name: "Apparel" }],
    avgRating: 0,
    reviewCount: 0,
    description: "Lightweight lawn kurta with hand-finished thread embroidery at the neckline.",
    highlights: ["Pure lawn fabric", "Hand-finished embroidery", "Dry clean recommended"],
    images: [],
    seo: NO_SEO,
    tags: ["kurta", "lawn", "embroidered"],
    categorySlugs: ["apparel"],
    deliveryCharge: 250,
  },
  {
    id: "prod_earbuds_003",
    slug: "wireless-earbuds-pro",
    title: "Wireless Earbuds Pro",
    currency: "PKR",
    price: 4999,
    compareAtPrice: 6500,
    stockStatus: "in_stock",
    primaryImage: null,
    categories: [{ id: "cat_electronics", slug: "electronics", name: "Electronics" }],
    avgRating: 4.2,
    reviewCount: 57,
    description: "True wireless earbuds with active noise cancellation and a charging case.",
    highlights: ["Active noise cancellation", "Up to 24 hours total playback", "IPX4 water resistance"],
    images: [],
    seo: NO_SEO,
    tags: ["audio", "wireless"],
    categorySlugs: ["electronics"],
    deliveryCharge: 0,
  },
  {
    id: "prod_sheets_004",
    slug: "premium-bed-sheet-set",
    title: "Premium Bed Sheet Set",
    currency: "PKR",
    price: 2750,
    compareAtPrice: null,
    stockStatus: "out_of_stock",
    primaryImage: null,
    categories: [{ id: "cat_home", slug: "home", name: "Home" }],
    avgRating: 4.8,
    reviewCount: 14,
    description: "Fitted sheet, flat sheet and two pillowcases in soft percale cotton.",
    highlights: ["Percale weave", "Four-piece set", "Shrink resistant"],
    images: [],
    seo: NO_SEO,
    tags: ["bedding", "cotton"],
    categorySlugs: ["home"],
    deliveryCharge: 300,
  },
  {
    id: "prod_rice_005",
    slug: "organic-basmati-rice-5kg",
    title: "Organic Basmati Rice 5kg, Extra Long Aged Grain Pack for Families Who Buy in Bulk Every Month",
    currency: "PKR",
    price: 2100,
    compareAtPrice: null,
    stockStatus: "in_stock",
    primaryImage: null,
    categories: [{ id: "cat_grocery", slug: "grocery", name: "Grocery" }],
    avgRating: 3.9,
    reviewCount: 3,
    description: "Long-grain basmati, aged for flavour and aroma, packed in a resealable bag.",
    highlights: ["Aged long grain", "Resealable pack", "Product of Pakistan"],
    images: [],
    seo: NO_SEO,
    tags: ["rice", "grocery", "bulk"],
    categorySlugs: ["grocery"],
    deliveryCharge: 200,
  },
];

export const DEFAULT_MOCK_PRODUCTS: StorefrontProductDetail[] = MOCK_PRODUCT_INPUTS.map(mockProduct);

export interface MockFixtures {
  products: StorefrontProductDetail[];
}

/**
 * A mock transport over a set of fixtures. Each instance has its own order book, so two themes' demos never see each
 * other's orders. The default instance below is the transport every demo used before this factory existed.
 */
export function createMockTransport(fixtures: MockFixtures): StorefrontTransport {
  const FIXTURES = fixtures.products;
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // Fresh copies per call, so callers cannot mutate the fixtures.
  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function toSummary(product: StorefrontProductDetail): StorefrontProductSummary {
    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      currency: product.currency,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      stockStatus: product.stockStatus,
      defaultVariantId: product.defaultVariantId,
      hasVariants: product.hasVariants,
      primaryImage: product.primaryImage,
      categories: product.categories,
      avgRating: product.avgRating,
      reviewCount: product.reviewCount,
    };
  }

  async function getProducts(): Promise<StorefrontProductSummary[]> {
    await delay(150);
    return FIXTURES.map((product) => toSummary(clone(product)));
  }

  async function getProduct(slug: string): Promise<StorefrontProductDetail | null> {
    await delay(150);
    const match = FIXTURES.find((product) => product.slug === slug);
    return match ? clone(match) : null;
  }

  // Orders accepted this session, keyed by idempotency key. A retry with the same key gets the first result back instead
  // of a second order. This is the duplicate-submit rule from the blueprint.
  const ORDER_DELAY_MS = 300;
  const orderBook = new Map<string, SubmitOrderResult>();
  // The same orders keyed by order id, so lookupOrder can find them.
  const orderById = new Map<string, StorefrontOrder>();
  let orderSequence = 1000;

  const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

  /** The variant a line means, as the seller backend resolves it. Null when the id does not belong to the product. */
  function variantOf(product: StorefrontProductDetail, variantId: string | undefined): StorefrontProductVariant | null {
    if (variantId !== undefined) return product.variants.find((variant) => variant.id === variantId) ?? null;
    if (product.variants.length === 1) return product.variants[0];
    throw new OrderRejectedError({ code: "variant_required", productId: product.id });
  }

  /**
   * Mock of POST /cart/quote. Prices come from the fixtures. The fixtures carry availability but no counts, so the mock
   * never reports insufficient_stock, and it charges no delivery.
   */
  async function quoteCart(input: CartQuoteInput): Promise<CartQuote> {
    await delay(120);
    const lines: CartQuoteLine[] = input.lines.map((line): CartQuoteLine => {
      const product = FIXTURES.find((item) => item.id === line.productId);
      if (!product) {
        return {
          productId: line.productId,
          variantId: line.variantId ?? null,
          title: null,
          variantTitle: null,
          unitPrice: null,
          qty: line.qty,
          lineTotal: null,
          issue: "unknown_product",
          availableQty: null,
        };
      }
      const variant = variantOf(product, line.variantId);
      if (!variant) {
        return {
          productId: product.id,
          variantId: line.variantId ?? null,
          title: product.title,
          variantTitle: null,
          unitPrice: null,
          qty: line.qty,
          lineTotal: null,
          issue: "unknown_variant",
          availableQty: null,
        };
      }
      const base = { productId: product.id, variantId: variant.id, title: product.title, variantTitle: variant.title };
      if (variant.availability === "out_of_stock") {
        return { ...base, unitPrice: variant.price, qty: line.qty, lineTotal: null, issue: "out_of_stock", availableQty: 0 };
      }
      return {
        ...base,
        unitPrice: variant.price,
        qty: line.qty,
        lineTotal: roundMoney(variant.price * line.qty),
        issue: null,
        availableQty: null,
      };
    });
    const subtotal = roundMoney(lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0));
    return {
      lines,
      subtotal,
      deliveryCharges: 0,
      total: subtotal,
      canCheckout: lines.length > 0 && lines.every((line) => line.issue === null),
    };
  }

  /** Mock of POST /orders. Prices come from the fixtures here, never from the client. */
  async function submitOrder(payload: SubmitOrderPayload): Promise<SubmitOrderResult> {
    await delay(ORDER_DELAY_MS);

    const replay = orderBook.get(payload.idempotencyKey);
    if (replay) return { ...replay };

    if (payload.lines.length === 0) throw new OrderRejectedError({ code: "empty_order" });

    const items: StorefrontOrderItem[] = [];
    for (const line of payload.lines) {
      if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 99) {
        throw new OrderRejectedError({ code: "invalid_quantity", productId: line.productId });
      }
      const product = FIXTURES.find((item) => item.id === line.productId);
      if (!product) throw new OrderRejectedError({ code: "unknown_product", productId: line.productId });
      const variant = variantOf(product, line.variantId);
      if (!variant) throw new OrderRejectedError({ code: "unknown_variant", productId: line.productId });
      if (variant.availability === "out_of_stock") {
        throw new OrderRejectedError({ code: "out_of_stock", productId: line.productId });
      }
      items.push({
        productId: product.id,
        variantId: variant.id,
        title: product.title,
        variantTitle: variant.title,
        unitPrice: variant.price,
        qty: line.qty,
        lineTotal: roundMoney(variant.price * line.qty),
      });
    }

    const total = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
    orderSequence += 1;
    const orderId = "ORD-" + orderSequence;
    const now = new Date().toISOString();

    // The mock charges no delivery, so the total is the subtotal. Payment is always cash on delivery here.
    orderById.set(orderId, {
      orderId,
      status: "pending",
      paymentMethod: "cod",
      subtotal: total,
      deliveryCharges: 0,
      total,
      createdAt: now,
      updatedAt: now,
      customerName: payload.customer.customerName,
      phone: normalizePhoneE164(payload.customer.phone) ?? payload.customer.phone,
      city: null,
      address: payload.customer.address,
      items,
    });

    const result: SubmitOrderResult = { orderId, total };
    orderBook.set(payload.idempotencyKey, result);
    return { ...result };
  }

  /** Mock of POST /orders/lookup. Matches the order id and the normalised phone, as the seller backend does. */
  async function lookupOrder(input: OrderLookupInput): Promise<StorefrontOrder | null> {
    await delay(150);
    const order = orderById.get(input.orderId.trim());
    if (!order) return null;
    const phone = normalizePhoneE164(input.phone);
    if (phone === null || phone !== order.phone) return null;
    return clone(order);
  }


  async function listProducts(query: ProductQuery = {}): Promise<ProductListPage> {
    await delay(150);
    let items = FIXTURES.filter((p) => (query.category ? p.categories.some((c) => c.slug === query.category) : true));
    if (query.q) {
      const needle = query.q.toLowerCase();
      items = items.filter((p) => p.title.toLowerCase().includes(needle));
    }
    if (query.sort === "price_asc") items = [...items].sort((a, b) => a.price - b.price);
    if (query.sort === "price_desc") items = [...items].sort((a, b) => b.price - a.price);
    if (query.sort === "rating") items = [...items].sort((a, b) => b.avgRating - a.avgRating);
    const limit = Math.max(1, query.limit ?? 48);
    const totalPages = Math.max(1, Math.ceil(items.length / limit));
    const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
    return { items: items.slice((page - 1) * limit, page * limit).map(toSummary), page, totalPages };
  }

  return { kind: "mock", getProducts, listProducts, getProduct, quoteCart, submitOrder, lookupOrder };
}

const defaultTransport = createMockTransport({ products: DEFAULT_MOCK_PRODUCTS });
export const getProducts = defaultTransport.getProducts;
export const getProduct = defaultTransport.getProduct;
export const quoteCart = defaultTransport.quoteCart;
export const submitOrder = defaultTransport.submitOrder;
export const lookupOrder = defaultTransport.lookupOrder;
export const mockTransport: StorefrontTransport = defaultTransport;

/* @theme-integration-patch:mock */
