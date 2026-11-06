import type { StorefrontCategory, StorefrontProductSummary } from "../transport/types";
import { storePaths } from "./paths";
import type { ProductCardVM } from "./product-card";

/** A category as a shopper navigates it. The list and its order are the seller's; the counts come from the catalogue. */
export interface CategoryVM {
  id: string;
  slug: string;
  name: string;
  /** The category's banner, else the primary image of its first product, else null. */
  image: { url: string; alt: string } | null;
  productCount: number;
  href: string;
}

/** What a theme's header, menus and search need on every page: the categories and the catalogue they came from. */
export interface StoreChromeVM {
  categories: CategoryVM[];
  products: ProductCardVM[];
}

/** The store's categories, in the order given, each with what the product list says about it. */
export function toCategoryVMs(categories: StorefrontCategory[], products: StorefrontProductSummary[]): CategoryVM[] {
  return categories.map((category) => {
    const held = products.filter((product) => product.categories.some((c) => c.id === category.id));
    const pictured = held.find((product) => product.primaryImage)?.primaryImage ?? null;
    const url = category.bannerUrl ?? pictured?.url ?? null;
    return {
      id: category.id,
      slug: category.slug,
      name: category.name,
      image: url ? { url, alt: category.name } : null,
      productCount: held.length,
      href: storePaths.collection(category.slug),
    };
  });
}
