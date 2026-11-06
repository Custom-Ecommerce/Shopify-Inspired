import type { StorefrontProductSummary } from "../transport/types";
import { storePaths } from "./paths";
import type { ProductCardVM } from "./product-card";

/** A category as a shopper navigates it. Derived from the store's own products, so it always belongs to that store. */
export interface CategoryVM {
  id: string;
  slug: string;
  name: string;
  /** The primary image of the first product in the category, or null when none has one. */
  image: { url: string; alt: string } | null;
  productCount: number;
  href: string;
}

/** What a theme's header, menus and search need on every page: the categories and the catalogue they came from. */
export interface StoreChromeVM {
  categories: CategoryVM[];
  products: ProductCardVM[];
}

/** Unique categories of a product list, in first-seen order. */
export function deriveCategories(products: StorefrontProductSummary[]): CategoryVM[] {
  const byId = new Map<string, CategoryVM>();
  for (const product of products) {
    for (const category of product.categories) {
      const existing = byId.get(category.id);
      if (existing) {
        existing.productCount += 1;
        if (existing.image === null && product.primaryImage) existing.image = { url: product.primaryImage.url, alt: category.name };
        continue;
      }
      byId.set(category.id, {
        id: category.id,
        slug: category.slug,
        name: category.name,
        image: product.primaryImage ? { url: product.primaryImage.url, alt: category.name } : null,
        productCount: 1,
        href: storePaths.collection(category.slug),
      });
    }
  }
  return [...byId.values()];
}
