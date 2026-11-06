import { TransportUnavailableError } from "../transport/errors";
import type { StorefrontTransport } from "../transport/types";
import { deriveCategories } from "../view-models/chrome";
import type { StoreChromeVM } from "../view-models/chrome";
import { toProductCardVM } from "../view-models/product-card";
import { loadAllProducts } from "./all-products";

/**
 * The categories and products a theme's layout needs. A backend that cannot be reached gives an empty chrome, so the
 * page still renders its own state instead of the whole store failing. Anything else is a bug and propagates.
 */
export async function loadStoreChrome(transport: StorefrontTransport): Promise<StoreChromeVM> {
  try {
    const products = await loadAllProducts(transport);
    return { categories: deriveCategories(products), products: products.map((p) => toProductCardVM(p)) };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { categories: [], products: [] };
    throw error;
  }
}
