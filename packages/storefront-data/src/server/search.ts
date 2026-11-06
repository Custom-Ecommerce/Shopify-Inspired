import { searchProductSummaries } from "../domain/search";
import { TransportUnavailableError } from "../transport/errors";
import type { TransportUnavailableReason } from "../transport/errors";
import type { StorefrontTransport } from "../transport/types";
import { toProductCardVM } from "../view-models/product-card";
import type { ProductCardVM } from "../view-models/product-card";

export type SearchPageData =
  | { status: "ok"; results: ProductCardVM[] }
  | { status: "unavailable"; reason: TransportUnavailableReason };

/**
 * Search results for a query. The search runs over the products the transport lists. The remote transport lists one
 * page, so a store with more products than that needs a search endpoint on the backend. An empty query has no results
 * and makes no request. Unavailability is a value, so the route can say so; anything else is a bug and propagates.
 */
export async function loadSearchPage(transport: StorefrontTransport, query: string): Promise<SearchPageData> {
  if (query.trim() === "") return { status: "ok", results: [] };
  try {
    const products = await transport.getProducts();
    const matches = searchProductSummaries(products, query);
    return { status: "ok", results: matches.map((product) => toProductCardVM(product)) };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}
