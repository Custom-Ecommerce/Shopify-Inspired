import type { CatalogPageData } from "./catalog";
import type { ProductDetailVM } from "./product-detail";
import type { ProductCardVM } from "./product-card";
import type { CategoryVM } from "./chrome";
import type { StorefrontProductReviews } from "../transport/types";

/** Shell-level view-models consumed by a theme's Layout (ThemeModule contract v1). */
export interface StoreVM {
  name: string;
  logoUrl: string | null;
  announcement: string | null;
  currency: string;
  locale: string;
  /** Sprint 4 SB-5: what the seller saved in settings. Optional, so a theme or a demo that has none still works. */
  description?: string | null;
  bannerUrl?: string | null;
  contact?: { phone: string | null; whatsapp: string | null; email: string | null; address: string | null; city: string | null };
  social?: { facebook: string | null; instagram: string | null; tiktok: string | null; whatsapp: string | null } | null;
  /** The seller's delivery time text, for example "2 to 4 days". */
  deliveryEstimate?: string | null;
}

export interface NavLinkVM {
  label: string;
  href: string;
}

export interface NavVM {
  links: NavLinkVM[];
}

export interface FooterVM {
  links: NavLinkVM[];
  copyright: string;
}

/** Page props. Where a presenter already existed, its prop shape is kept unchanged. */
export interface HomePageProps {
  featured: ProductCardVM[];
  /** Categories and the whole catalogue, for themes that group by category. */
  categories?: CategoryVM[];
  products?: ProductCardVM[];
}
export interface CatalogPageProps {
  data: CatalogPageData;
}
export interface ProductPageProps {
  slug: string;
  /** Loaded on the server for a live store. Omitted by the demo, which loads it on the client. */
  product?: ProductDetailVM;
  /**
   * Sprint 5 EP-21.US01.T03: the product's approved reviews (first page, newest first) with the average and the count, read on the server under the
   * product's cache tag. Omitted by the demo: a theme then uses useProductReviews, which reads them through the transport.
   */
  reviews?: StorefrontProductReviews | null;
}
export interface SearchPageProps {
  query: string;
  results: ProductCardVM[];
}
export type CartPageProps = Record<string, never>;
export type CheckoutPageProps = Record<string, never>;
export interface OrderConfirmationPageProps {
  orderId: string;
  /**
   * EP-07.US01.T05: a wa.me link to the store's WhatsApp number with a prefilled question about this order, built on the
   * server from the public store data. Absent or null when the store has no WhatsApp number (or for the demo).
   */
  sellerWhatsappLink?: string | null;
}
export interface OrderTrackingPageProps {
  orderId?: string;
}
export interface ContentPageProps {
  title: string;
  body: string;
}
export type NotFoundPageProps = Record<string, never>;
/** The list lives in the browser, so the page loads it with useFavouriteProducts. */
export type FavouritesPageProps = Record<string, never>;
export interface CollectionsPageProps {
  categories: CategoryVM[];
}
export interface CollectionPageProps {
  slug: string;
  category: CategoryVM;
  products: ProductCardVM[];
}
export interface FeedbackPageProps {
  productSlug?: string;
  orderId?: string;
}
export interface UnavailablePageProps {
  message?: string;
  /** A link back to the page that failed, for server pages. */
  retryHref?: string;
  /** A retry that runs in the browser, for client error boundaries (their reset). */
  onRetry?: () => void;
}
/* @theme-integration-patch:pages */
