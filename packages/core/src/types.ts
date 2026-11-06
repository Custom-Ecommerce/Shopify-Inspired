export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface Product {
  id: string;
  slug: string;
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: string;
  categorySlug: string;
  images: string[];
  stockStatus: StockStatus;
  deliveryCharges: number;
  highlights: string[];
  isFeatured?: boolean;
  // Phase 7.4 — optional per-product SEO overrides, carried through from
  // Payload's Product.seoTitle/seoDescription/seoImage (see
  // apps/admin/src/collections/Products.ts). Optional because most
  // products won't set these — the storefront falls back to
  // title/description when absent (see (store)/product/[id]/page.tsx's
  // generateMetadata).
  seoTitle?: string;
  seoDescription?: string;
  seoImage?: string;
  avgRating?: number;
  reviewCount?: number;
  // Phase Q.1 — added per the completeness check; `lowStockThreshold` and
  // `stockHistory` were also on that checklist but are deliberately NOT
  // added here — they're dashboard/seller-only inventory-management
  // fields (an audit log and an alert threshold), never rendered on the
  // customer-facing storefront this type serves. The dashboard already
  // reads them directly off the raw `PayloadProductDoc` (admin's
  // generated type), not through this lean, customer-facing projection —
  // adding them here would leak internal fields into `CartItem`/
  // `SearchableProduct` derivations that have no use for them.
  viewCount?: number;
}

export interface Category {
  slug: string;
  name: string;
  description?: string;
  image?: string;
  order?: number;
}

// A single normalized line item living inside the cart / order.
// CartItem is the ONE place a Product gets flattened into cart-shape data —
// every consumer (drawer, checkout, order log) reads from CartItem, never
// re-derives fields from the original Product. This keeps the CSV-sourced
// Product record as the single upstream source of truth while giving the
// cart a stable, serializable shape for localStorage persistence.
export interface CartItem {
  productId: string;
  slug: string;
  title: string;
  image: string;
  price: number;
  originalPrice?: number;
  categorySlug: string;
  deliveryCharges: number;
  stockStatus: StockStatus;
  quantity: number;
}

export interface OrderLineItem {
  productId: string;
  productTitle: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderPayload {
  orderId: string;
  items: OrderLineItem[];
  subtotal: number;
  deliveryCharges: number;
  total: number;
  customerName: string;
  phone: string;
  secondaryPhone?: string;
  address: string;
  city: string;
  notes?: string;
  paymentMethod: "cod";
  createdAt: string;
}

// Lean, client-safe projection of Product used to hydrate the client-side
// search index. Intentionally omits nothing search needs to match against
// (title/category/description) while staying small on the wire.
export interface SearchableProduct {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  categorySlug: string;
  image: string;
  stockStatus: StockStatus;
}
