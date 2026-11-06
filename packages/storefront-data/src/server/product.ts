import { TransportUnavailableError } from "../transport/errors";
import type { TransportUnavailableReason } from "../transport/errors";
import type { StorefrontTransport } from "../transport/types";
import { toProductDetailVM } from "../view-models/product-detail";
import type { ProductDetailVM } from "../view-models/product-detail";

export type ProductPageData =
  | { status: "ok"; product: ProductDetailVM }
  | { status: "not-found" }
  | { status: "unavailable"; reason: TransportUnavailableReason };

/**
 * Product page data for a live store. A missing product and an unreachable backend are both values, so the route can
 * answer each one with the right page. Anything else is a bug and propagates to the error boundary.
 */
export async function loadProductPage(transport: StorefrontTransport, slug: string): Promise<ProductPageData> {
  try {
    const product = await transport.getProduct(slug);
    if (product === null) return { status: "not-found" };
    return { status: "ok", product: toProductDetailVM(product) };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}
