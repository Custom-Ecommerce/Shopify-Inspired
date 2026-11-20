import { TransportUnavailableError } from "../transport/errors";
import type { TransportUnavailableReason } from "../transport/errors";
import type { StorefrontProductReviews, StorefrontTransport } from "../transport/types";
import { toProductDetailVM } from "../view-models/product-detail";
import type { ProductDetailVM } from "../view-models/product-detail";

export type ProductPageData =
  /** `reviews` (Sprint 5 EP-21.US01.T03) is the product's first page of approved reviews, or null when they could not be read: the page then shows none. */
  | { status: "ok"; product: ProductDetailVM; reviews?: StorefrontProductReviews | null }
  | { status: "not-found" }
  | { status: "unavailable"; reason: TransportUnavailableReason };

/**
 * Product page data for a live store. A missing product and an unreachable backend are both values, so the route can
 * answer each one with the right page. Anything else is a bug and propagates to the error boundary.
 *
 * The product's reviews are read in the same pass, under the product's own cache tag, so a review published, hidden or answered drops them
 * together with the product. They are never required: when they cannot be read the page shows the product without them.
 */
export async function loadProductPage(transport: StorefrontTransport, slug: string): Promise<ProductPageData> {
  try {
    const product = await transport.getProduct(slug);
    if (product === null) return { status: "not-found" };
    const reviews = await transport.getProductReviews(slug, 1).catch(() => null);
    return { status: "ok", product: toProductDetailVM(product), reviews };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}
