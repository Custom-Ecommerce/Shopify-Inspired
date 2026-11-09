"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { EMPTY_CHECKOUT_VALUES, validateCheckout } from "../domain/checkout";
import type { CheckoutField, CheckoutFieldErrors, CheckoutValues } from "../domain/checkout";
import type { Money } from "../domain/money";
import type { OrderTransport, PaymentMethod } from "../transport/types";
import type { CartLineVM } from "../view-models/cart";
import { toCheckoutFailure } from "./checkout-failure";
import type { CheckoutFailure } from "./checkout-failure";
import { useOrderTransport } from "./context";
import { useCart } from "./use-cart";
import { placeOrderWithCheck } from "./place-order";

export type { CheckoutFailure } from "./checkout-failure";

export type CheckoutStatus = "editing" | "submitting" | "success" | "error";

export interface UseCheckoutResult {
  values: CheckoutValues;
  /** Shown after the first submit attempt, then kept live as the shopper edits. */
  errors: CheckoutFieldErrors;
  status: CheckoutStatus;
  /** True while a placement that got no answer is being checked. status stays "submitting" meanwhile. */
  isChecking: boolean;
  failure: CheckoutFailure | null;
  /** Set once the server accepts the order. The theme navigates to the confirmation when it appears. */
  orderId: string | null;
  /** Set with orderId for a card order: where the shopper pays. The theme sends the browser there. */
  checkoutUrl: string | null;
  isCartReady: boolean;
  isCartEmpty: boolean;
  lines: CartLineVM[];
  subtotal: Money;
  setField: (field: CheckoutField, value: string) => void;
  /** Places the order. A theme that owns its own form passes the values here; without them the hook's own values are used. */
  submit: (override?: CheckoutValues, options?: { paymentMethod?: PaymentMethod }) => Promise<void>;
}

interface Attempt {
  signature: string;
  key: string;
}

function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return "idem-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/**
 * The checkout for the storefront this component is rendered under. Orders go through that storefront's transport:
 * the BFF on a live store, fixtures on the demo. Pass a transport only in tests.
 */
export function useCheckout(transportOverride?: OrderTransport): UseCheckoutResult {
  const contextTransport = useOrderTransport();
  const transport = transportOverride ?? contextTransport;
  const cart = useCart();
  const { lines, isHydrated, clear, discountCode } = cart;

  const [values, setValues] = useState<CheckoutValues>(EMPTY_CHECKOUT_VALUES);
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<CheckoutStatus>("editing");
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);

  const errors = useMemo<CheckoutFieldErrors>(() => {
    if (!attempted) return {};
    const validation = validateCheckout(values);
    return validation.ok ? {} : validation.errors;
  }, [attempted, values]);

  const setField = useCallback((field: CheckoutField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  }, []);

  const submit = useCallback(async (override?: CheckoutValues, options?: { paymentMethod?: PaymentMethod }) => {
    const submitted = override ?? values;
    // A second click while the first request is pending must not place a second order.
    if (inFlight.current || !isHydrated) return;
    setAttempted(true);

    const validation = validateCheckout(submitted);
    if (!validation.ok) return;

    if (lines.length === 0) {
      setFailure({ kind: "empty_cart" });
      setStatus("error");
      return;
    }

    // Retries of the same order reuse one key. Any change to the order gets a fresh key.
    const submission = validation.data;
    const payloadLines = lines.map((line) => ({ productId: line.productId, variantId: line.variantId, qty: line.qty }));
    const paymentMethod = options?.paymentMethod;
    const signature = JSON.stringify({ customer: submission, lines: payloadLines, discountCode, paymentMethod });
    if (!attempt.current || attempt.current.signature !== signature) {
      attempt.current = { signature, key: newIdempotencyKey() };
    }
    const idempotencyKey = attempt.current.key;

    inFlight.current = true;
    setStatus("submitting");
    setFailure(null);
    try {
      const placed = await placeOrderWithCheck(
        transport,
        { idempotencyKey, customer: submission, lines: payloadLines, discountCode, paymentMethod },
        () => setIsChecking(true),
      );
      attempt.current = null;
      clear();
      setCheckoutUrl(placed.checkoutUrl ?? null);
      setOrderId(placed.orderId);
      setStatus("success");
    } catch (error) {
      const failed = toCheckoutFailure(error, lines);
      // That order was cancelled, so the same key would only find it again. Trying again must be a new order.
      if (failed.kind === "payment_not_started") attempt.current = null;
      setFailure(failed);
      setStatus("error");
    } finally {
      inFlight.current = false;
      setIsChecking(false);
    }
  }, [values, lines, isHydrated, clear, transport, discountCode]);

  return {
    values,
    errors,
    status,
    isChecking,
    failure,
    orderId,
    checkoutUrl,
    isCartReady: isHydrated,
    isCartEmpty: cart.isEmpty,
    lines,
    subtotal: cart.subtotal,
    setField,
    submit,
  };
}
/* @theme-integration-patch:checkout-hook */
