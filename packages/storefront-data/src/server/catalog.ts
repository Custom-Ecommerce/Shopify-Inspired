import { TransportUnavailableError } from "../transport/errors";
import type { ProductQuery, StorefrontTransport } from "../transport/types";
import type { CatalogPageData } from "../view-models/catalog";
import { toProductCardVM } from "../view-models/product-card";

/**
 * Catalog container data. The caller chooses the transport, so one loader serves mock and remote
 * data alike. Unavailability is a value, not an exception, so the presenter can say so.
 * Anything else is a bug and propagates.
 */
export async function loadCatalogPage(transport: StorefrontTransport, query?: ProductQuery): Promise<CatalogPageData> {
  try {
    const products = query && transport.listProducts ? (await transport.listProducts(query)).items : await transport.getProducts();
    return { status: "ok", products: products.map((product) => toProductCardVM(product)) };
  } catch (error) {
    if (error instanceof TransportUnavailableError) {
      return { status: "unavailable", reason: error.reason };
    }
    throw error;
  }
}
/* @theme-integration-patch:catalog */
