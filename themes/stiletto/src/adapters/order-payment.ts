"use client";

import { useEffect, useState } from "react";
import type { StorefrontOrder } from "@markaz/storefront-data";
import { useOrderTransport } from "@markaz/storefront-data/client";
import { readLastOrder } from "./last-order";

/** Stripe's message can land a few seconds after the shopper returns. Few tries, because each counts against the lookup limit. */
const LOOKUPS = 4;
const LOOKUP_GAP_MS = 3000;

export interface ConfirmedOrder {
  /** "ask" means this tab has no way to read the order, so the page asks for the order number and phone. */
  status: "loading" | "found" | "ask";
  order: StorefrontOrder | null;
}

const stillWaiting = (order: StorefrontOrder): boolean => order.paymentMethod === "card" && order.paymentStatus === "unpaid" && order.status !== "cancelled";

/** The order this tab placed, read with its token, and read again for a short while if a card payment has not been confirmed. */
export function useConfirmedOrder(orderId: string): ConfirmedOrder {
  const transport = useOrderTransport();
  const [state, setState] = useState<ConfirmedOrder>({ status: "loading", order: null });

  useEffect(() => {
    const token = readLastOrder(orderId)?.accessToken ?? null;
    if (token === null) {
      setState({ status: "ask", order: null });
      return;
    }
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const look = async (triesLeft: number): Promise<void> => {
      const order = await transport.confirmOrder({ orderNumber: orderId, token }).catch(() => null);
      if (!current) return;
      if (order === null) {
        setState((previous) => (previous.order ? previous : { status: "ask", order: null }));
        return;
      }
      setState({ status: "found", order });
      if (stillWaiting(order) && triesLeft > 1) timer = setTimeout(() => void look(triesLeft - 1), LOOKUP_GAP_MS);
    };
    void look(LOOKUPS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [transport, orderId]);

  return state;
}
