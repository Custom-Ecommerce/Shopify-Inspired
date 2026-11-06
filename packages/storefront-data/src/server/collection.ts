import { TransportUnavailableError } from "../transport/errors";
import type { TransportUnavailableReason } from "../transport/errors";
import type { StorefrontTransport } from "../transport/types";
import { deriveCategories } from "../view-models/chrome";
import type { CategoryVM } from "../view-models/chrome";
import type { ProductCardVM } from "../view-models/product-card";
import { toProductCardVM } from "../view-models/product-card";
import { loadAllProducts } from "./all-products";

export type CollectionPageData =
  | { status: "ok"; category: CategoryVM; products: ProductCardVM[] }
  | { status: "not-found" }
  | { status: "unavailable"; reason: TransportUnavailableReason };

/** One category and its products. Categories are derived from products, so an unknown slug is simply not found. */
export async function loadCollectionPage(transport: StorefrontTransport, slug: string): Promise<CollectionPageData> {
  try {
    const products = await loadAllProducts(transport);
    const category = deriveCategories(products).find((c) => c.slug === slug);
    if (!category) return { status: "not-found" };
    const matching = products.filter((p) => p.categories.some((c) => c.slug === slug));
    return { status: "ok", category, products: matching.map((p) => toProductCardVM(p)) };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}
