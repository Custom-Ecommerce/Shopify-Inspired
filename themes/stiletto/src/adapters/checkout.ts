"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckoutFailure } from "@markaz/storefront-data/client";
import { checkoutServerFieldError, useCart, useCartQuote, useCheckout } from "@markaz/storefront-data/client";
import { boxForField, firstErrorBox, stilettoFieldErrors, toCheckoutValues } from "./checkout-fields";
import type { StilettoCheckoutField, StilettoCheckoutInput, StilettoFieldErrors } from "./checkout-fields";
import { paths } from "./paths";
import { rememberLastOrder } from "./last-order";

export type { StilettoCheckoutInput } from "./checkout-fields";

/** A refusal whose message is written for developers ("lines.0.qty: ...") and so is not shown as it stands. */
const TECHNICAL_MESSAGE = /^[\w.]+:\s/;

function failureMessage(f: CheckoutFailure): string {
  switch (f.kind) {
    case "empty_cart":
      return "Your cart is empty!";
    case "out_of_stock":
      return (f.productTitle ?? "An item in your cart") + " is out of stock. Please remove it and try again.";
    case "unknown_product":
      return (f.productTitle ?? "An item in your cart") + " is no longer available. Please remove it and try again.";
    case "invalid_quantity":
      return "One of the quantities in your cart is not valid.";
    case "rate_limited":
      return "Too many attempts. Please wait a moment and try again.";
    case "store_inactive":
      return "This store is not taking orders right now.";
    case "invalid_request":
      return TECHNICAL_MESSAGE.test(f.message) ? "Please check your details and try again." : f.message;
    case "payment_method_unavailable":
      return "Cash on delivery is not available for this store.";
    case "unconfirmed":
      return "We could not confirm your order. Please try again; you will not be charged twice.";
    case "idempotency_conflict":
    case "unavailable":
    default:
      return "Could not place order. Please try again.";
  }
}

/**
 * Stiletto's checkout on top of the storefront's. The form keeps its own state, which an error never resets; this joins
 * the fields the store keeps, prices the cart on the server, places the order and moves to the order page. Each message
 * goes on the box it is about. Billing address is shown for design parity and is not sent.
 */
export function useStilettoCheckout() {
  const router = useRouter();
  const { isEmpty } = useCart();
  const { quote } = useCartQuote();
  const checkout = useCheckout();
  const [fieldErrors, setFieldErrors] = useState<StilettoFieldErrors>({});
  // Goes up whenever messages appear, so the form can move the shopper to the first one.
  const [focusTick, setFocusTick] = useState(0);
  const placed = useRef({ total: 0, whatsapp: "" });
  const lastInput = useRef<StilettoCheckoutInput | null>(null);

  // Only the server's prices are shown once it has answered. The cart's own prices can be older than the catalog.
  const priced = !isEmpty && quote !== null ? quote : null;
  const deliveryCharges = priced ? priced.deliveryCharges.amount : 0;
  const subtotal = priced ? priced.subtotal.amount : checkout.subtotal.amount;
  const grandTotal = priced ? priced.total.amount : checkout.subtotal.amount;
  const grandTotalRef = useRef(grandTotal);
  grandTotalRef.current = grandTotal;

  /** The server's total for a line, or null when it has none: not answered yet, or the line cannot be bought. */
  const lineTotalOf = useCallback(
    (productId: string | undefined, variantId: string | undefined): number | null => {
      const match = priced?.lines.find(
        (line) => line.productId.toLowerCase() === productId?.toLowerCase() && line.variantId?.toLowerCase() === variantId?.toLowerCase(),
      );
      return match?.lineTotal?.amount ?? null;
    },
    [priced],
  );

  useEffect(() => {
    if (checkout.status === "success" && checkout.orderId) {
      rememberLastOrder({ orderId: checkout.orderId, total: placed.current.total, whatsapp: placed.current.whatsapp });
      router.push(paths.order(checkout.orderId));
    }
  }, [checkout.status, checkout.orderId, router]);

  // A refusal from the server about one field reads the same as the form's own message for it.
  const serverField = checkoutServerFieldError(checkout.failure);
  const serverBox = serverField && lastInput.current ? boxForField(serverField.field, lastInput.current) : null;
  useEffect(() => {
    if (serverField === null || serverBox === null) return;
    setFieldErrors((previous) => ({ ...previous, [serverBox]: serverField.message }));
    setFocusTick((tick) => tick + 1);
    // One message per refusal: the failure object is new each time the server refuses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout.failure]);

  const submit = useMemo(
    () => async (input: StilettoCheckoutInput) => {
      lastInput.current = input;
      const errors = stilettoFieldErrors(input);
      setFieldErrors(errors);
      if (firstErrorBox(errors) !== null) {
        setFocusTick((tick) => tick + 1);
        return;
      }
      const values = toCheckoutValues(input);
      placed.current = { total: grandTotalRef.current, whatsapp: values.phone };
      await checkout.submit(values);
    },
    [checkout],
  );

  /** Called as the shopper edits a box, so its message goes away once they start to fix it. */
  const clearFieldError = useCallback((field: StilettoCheckoutField) => {
    setFieldErrors((previous) => {
      if (previous[field] === undefined) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }, []);

  // A refusal shown beside its box is not repeated in the banner.
  const failure = checkout.failure && serverBox === null ? failureMessage(checkout.failure) : null;
  return {
    subtotal,
    deliveryCharges,
    grandTotal,
    lineTotalOf,
    isSubmitting: checkout.status === "submitting" || checkout.status === "success",
    isChecking: checkout.isChecking,
    /** The retry reuses the same order and so the same idempotency key. */
    canRetryUnconfirmed: checkout.failure?.kind === "unconfirmed",
    orderError: failure,
    fieldErrors,
    focusTick,
    clearFieldError,
    submit,
  };
}
