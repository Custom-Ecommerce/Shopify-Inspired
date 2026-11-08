import { OrderRejectedError, OrderUnconfirmedError } from "../transport/errors";
import type { OrderRejection } from "../transport/types";

/**
 * Why checkout failed. Typed so a theme can say exactly what to fix. productTitle is filled from the cart
 * when the server names a product that is in it, so the copy can name the item.
 */
export type CheckoutFailure =
  | { kind: "empty_cart" }
  | { kind: "out_of_stock"; productId: string | null; productTitle: string | null }
  | { kind: "unknown_product"; productId: string | null; productTitle: string | null }
  | { kind: "invalid_quantity"; productId: string | null; productTitle: string | null }
  | { kind: "payment_method_unavailable" }
  | { kind: "idempotency_conflict" }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "invalid_request"; message: string }
  | { kind: "store_inactive" }
  | { kind: "unavailable" }
  /** No clear answer even after checking with the same key. Trying again cannot place a second order (CO-03). */
  | { kind: "unconfirmed" };

type CartLineRef = { productId: string; title: string };

/** The cart's title for a product the server named, when the shopper still has it in the cart. */
export function cartTitle(lines: readonly CartLineRef[], productId: string | undefined): string | null {
  if (productId === undefined) return null;
  return lines.find((line) => line.productId === productId)?.title ?? null;
}

/**
 * Turns a thrown error into the failure the UI shows. Only refusals carry a reason. Anything else (network,
 * timeout, a backend bug) is "unavailable". The switch is exhaustive: a rejection code added to
 * OrderRejection without a case here does not compile.
 */
export function toCheckoutFailure(error: unknown, lines: readonly CartLineRef[]): CheckoutFailure {
  if (error instanceof OrderUnconfirmedError) return { kind: "unconfirmed" };
  if (!(error instanceof OrderRejectedError)) return { kind: "unavailable" };
  const rejection: OrderRejection = error.rejection;
  switch (rejection.code) {
    case "empty_order":
      return { kind: "empty_cart" };
    case "out_of_stock":
      return {
        kind: "out_of_stock",
        productId: rejection.productId ?? null,
        productTitle: cartTitle(lines, rejection.productId),
      };
    // A variant gone from the catalog, or a product no longer for sale, reads to a shopper like a product gone from it,
    // so themes need no new case.
    case "variant_required":
    case "unknown_variant":
    case "product_unavailable":
    case "unknown_product":
      return {
        kind: "unknown_product",
        productId: rejection.productId ?? null,
        productTitle: cartTitle(lines, rejection.productId),
      };
    case "invalid_quantity":
      return {
        kind: "invalid_quantity",
        productId: rejection.productId ?? null,
        productTitle: cartTitle(lines, rejection.productId),
      };
    case "payment_method_unavailable":
      return { kind: "payment_method_unavailable" };
    case "idempotency_conflict":
      return { kind: "idempotency_conflict" };
    case "rate_limited":
      return { kind: "rate_limited", retryAfterSeconds: rejection.retryAfterSeconds };
    case "invalid_request":
      return { kind: "invalid_request", message: rejection.message };
    case "store_inactive":
      return { kind: "store_inactive" };
    default: {
      const unhandled: never = rejection;
      void unhandled;
      return { kind: "unavailable" };
    }
  }
}
