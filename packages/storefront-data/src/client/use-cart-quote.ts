"use client";

import { useEffect, useMemo, useState } from "react";
import { toCartQuoteVM } from "../view-models/cart-quote";
import type { CartQuoteVM } from "../view-models/cart-quote";
import { useOrderTransport } from "./context";
import { useCart } from "./use-cart";

export type CartQuoteStatus = "idle" | "loading" | "ready" | "unavailable";

export interface UseCartQuoteResult {
  status: CartQuoteStatus;
  /** The server's priced view of the cart. Null until it has answered, and when it cannot. */
  quote: CartQuoteVM | null;
}

/**
 * Asks the server to price the cart whenever its lines change, so stock and totals come from the source. The cart keeps
 * working when the quote cannot be had: checkout validates again when the order is placed.
 */
export function useCartQuote(options: { enabled?: boolean; city?: string | null } = {}): UseCartQuoteResult {
  const enabled = options.enabled ?? true;
  // Sprint 4 EP-04.US02: the shipping city, so the quote uses the store's rate for it. Blank counts as no city.
  const city = options.city?.trim() ? options.city.trim() : null;
  const transport = useOrderTransport();
  const { lines, isHydrated, discountCode } = useCart();
  const requested = useMemo(
    () => lines.map((line) => ({ productId: line.productId, variantId: line.variantId, qty: line.qty })),
    [lines],
  );
  // Keyed on the serialised lines and code, so an unchanged cart is not quoted again.
  const key = JSON.stringify([requested, discountCode, city]);
  const [state, setState] = useState<UseCartQuoteResult>({ status: "idle", quote: null });

  useEffect(() => {
    if (!isHydrated || !enabled) return;
    if (requested.length === 0) {
      setState({ status: "ready", quote: null });
      return;
    }
    let current = true;
    setState((previous) => ({ status: "loading", quote: previous.quote }));
    transport.quoteCart({ lines: requested, discountCode, city }).then(
      (quote) => {
        if (current) setState({ status: "ready", quote: toCartQuoteVM(quote) });
      },
      () => {
        if (current) setState({ status: "unavailable", quote: null });
      },
    );
    return () => {
      current = false;
    };
    // `requested` is read through `key`, which is its serialised form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isHydrated, transport, enabled]);

  return state;
}
