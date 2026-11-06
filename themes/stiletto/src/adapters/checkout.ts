"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateCheckout } from "@markaz/storefront-data";
import type { CheckoutFailure } from "@markaz/storefront-data/client";
import { useCart, useCartQuote, useCheckout } from "@markaz/storefront-data/client";
import type { AddressDetails } from "../model";
import { paths } from "./paths";
import { rememberLastOrder } from "./last-order";

export interface StilettoCheckoutInput {
  whatsapp: string;
  shippingAddress: AddressDetails;
  billingAddress: AddressDetails;
  sameAsShipping: boolean;
  notes: string;
}

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
      return f.message;
    case "payment_method_unavailable":
      return "Cash on delivery is not available for this store.";
    case "idempotency_conflict":
    case "unavailable":
    default:
      return "Could not place order. Please try again.";
  }
}

/**
 * Stiletto's checkout on top of the storefront's. The form keeps its own state; this joins the fields the SaaS stores
 * (name, phone, address), prices the cart on the server, places the order and moves to the order page.
 * Email, billing address and order notes are shown for design parity and are not sent.
 */
export function useStilettoCheckout() {
  const router = useRouter();
  const { isEmpty } = useCart();
  const { quote } = useCartQuote();
  const checkout = useCheckout();
  const [validationError, setValidationError] = useState<string | null>(null);
  const placed = useRef({ total: 0, whatsapp: "" });

  const deliveryCharges = !isEmpty && quote ? quote.deliveryCharges.amount : 0;
  const grandTotal = quote && !isEmpty ? quote.total.amount : checkout.subtotal.amount;
  const grandTotalRef = useRef(grandTotal);
  grandTotalRef.current = grandTotal;

  useEffect(() => {
    if (checkout.status === "success" && checkout.orderId) {
      rememberLastOrder({ orderId: checkout.orderId, total: placed.current.total, whatsapp: placed.current.whatsapp });
      router.push(paths.order(checkout.orderId));
    }
  }, [checkout.status, checkout.orderId, router]);

  const submit = useMemo(
    () => async (input: StilettoCheckoutInput) => {
      const a = input.shippingAddress;
      const values = {
        customerName: (a.firstName + " " + a.lastName).trim(),
        phone: input.whatsapp || a.phone,
        address: [a.address1, a.address2, a.city, a.zip].map((p) => (p ?? "").trim()).filter(Boolean).join(", "),
      };
      const v = validateCheckout(values);
      if (!v.ok) {
        setValidationError(v.errors.customerName ?? v.errors.phone ?? v.errors.address ?? "Please check your details.");
        return;
      }
      setValidationError(null);
      placed.current = { total: grandTotalRef.current, whatsapp: values.phone };
      await checkout.submit(values);
    },
    [checkout],
  );

  const failure = checkout.failure ? failureMessage(checkout.failure) : null;
  return {
    deliveryCharges,
    grandTotal,
    isSubmitting: checkout.status === "submitting" || checkout.status === "success",
    orderError: validationError ?? failure,
    submit,
  };
}
