import type { TransportUnavailableReason } from "../transport/errors";
import type { ProductCardVM } from "./product-card";

/** What the catalog presenter receives. Either the products, or the reason there are none. */
export type CatalogPageData =
  | { status: "ok"; products: ProductCardVM[] }
  | { status: "unavailable"; reason: TransportUnavailableReason };
