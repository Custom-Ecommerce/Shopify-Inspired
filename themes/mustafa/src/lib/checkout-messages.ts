import type { CheckoutFailure } from "@markaz/storefront-data/client";

/** The customer fields the checkout form owns. The server names the same keys in its messages. */
export type CheckoutFormField = "customerName" | "phone" | "address" | "city";

export interface ServerFieldError {
  field: CheckoutFormField;
  /** The server's message with its first letter capitalised, ready to show under the field. */
  message: string;
}

const CUSTOMER_FIELD = /^customer\.(customerName|phone|address|city):\s*(.+)$/;

function capitalise(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * The BFF reports the first invalid input as "path: message", for example
 * "customer.phone: enter a valid mobile number." A message about one of the customer's fields belongs beside
 * that field. Anything else stays in the banner.
 */
export function parseServerFieldError(failure: CheckoutFailure): ServerFieldError | null {
  if (failure.kind !== "invalid_request") return null;
  const match = CUSTOMER_FIELD.exec(failure.message.trim());
  if (match === null) return null;
  return { field: match[1] as CheckoutFormField, message: capitalise(match[2] ?? "") };
}

/** The theme's own words for a checkout failure. The data layer only says why; the copy lives here. */
export function failureCopy(failure: CheckoutFailure): string {
  switch (failure.kind) {
    case "empty_cart":
      return "Your cart is empty.";
    case "out_of_stock":
      return failure.productTitle
        ? failure.productTitle + " is out of stock. Remove it from your cart to continue."
        : "An item in your cart is out of stock. Remove it from your cart to continue.";
    case "unknown_product":
      return failure.productTitle
        ? failure.productTitle + " is no longer available. Remove it from your cart to continue."
        : "An item in your cart is no longer available. Remove it from your cart to continue.";
    case "invalid_quantity":
      return failure.productTitle
        ? "The quantity for " + failure.productTitle + " is not allowed. Change it in your cart."
        : "An item in your cart has a quantity that is not allowed. Change it in your cart.";
    case "payment_method_unavailable":
      return "This payment method is not available for this store right now.";
    case "idempotency_conflict":
      return "Your order details changed while it was being placed. Check your details and try again.";
    case "rate_limited":
      return failure.retryAfterSeconds
        ? "Too many attempts. Please wait about " + Math.ceil(failure.retryAfterSeconds) + " seconds and try again."
        : "Too many attempts. Please wait a moment and try again.";
    case "invalid_request":
      return "Please check your details and try again.";
    case "store_inactive":
      return "This store is not accepting orders right now.";
    case "unavailable":
      return "We could not place your order. Please try again.";
    case "unconfirmed":
      return "We could not confirm your order. Please try again; you will not be charged twice.";
  }
}

/** A refusal about a cart line. The fix is in the cart, so the message links there. */
export function isCartItemFailure(failure: CheckoutFailure): boolean {
  return (
    failure.kind === "out_of_stock" || failure.kind === "unknown_product" || failure.kind === "invalid_quantity"
  );
}
