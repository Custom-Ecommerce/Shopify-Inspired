/**
 * The theme's own data shapes. Stiletto's UI was written against these; the adapters build them from the
 * storefront view-models. Nothing here knows where the data comes from.
 */
export interface ReviewItem {
  id: string;
  orderId?: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
}

export interface NormalizedVariant {
  id: string;
  title: string;
  availableForSale?: boolean;
  price?: { amount: string; currencyCode?: string };
  compareAtPrice?: { amount: string; currencyCode?: string } | null;
  selectedOptions?: { name: string; value: string }[];
}

export interface NormalizedOption {
  id?: string;
  name: string;
  values: string[];
}

export interface NormalizedProductSpec {
  key: string;
  label: string;
  value: string;
}

export interface NormalizedProduct {
  id: string;
  title: string;
  handle: string;
  productType: string;
  tags: string[];
  price: string;
  images: string[];
  /** The same images with their alt text, in the seller's order. The first is the primary. */
  gallery?: { id?: string | null; url: string; alt: string }[];
  /** What the product page says about stock. */
  stockLabel?: string;
  stockTone?: "positive" | "negative";
  sizes: string[];
  colors: string[];
  variantsInfo: string;
  link: string;
  descriptionHtml?: string;
  plainTextDescription?: string;
  options?: NormalizedOption[];
  packOption?: NormalizedOption | null;
  hasPackOption?: boolean;
  variants?: NormalizedVariant[];
  metafields?: Array<{ id?: string; key?: string; value: string }>;
  specs?: NormalizedProductSpec[];
  reviews: ReviewItem[];
  /** Only in a seller's preview: the data layer's tag for this product. */
  previewLabel?: string | null;
}

export interface NormalizedCategory {
  id: string;
  title: string;
  handle: string;
  image: string;
  href: string;
  descriptionHtml?: string;
  plainTextDescription?: string;
  videoUrl?: string;
  products?: NormalizedProduct[];
}

export interface AddressDetails {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  zip?: string;
  phone: string;
  country: string;
}

/** Store facts the theme shows. Built from the storefront's StoreVM by the layout. */
export interface StoreData {
  name: string;
  logoUrl: string | null;
  announcement: string | null;
  currency: string;
  locale: string;
  mode: "demo" | "live";
}
