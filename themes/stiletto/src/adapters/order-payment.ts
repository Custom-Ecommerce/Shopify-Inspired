"use client";

import { useEffect, useState } from "react";
import { useOrderTransport } from "@markaz/storefront-data/client";
import { paymentLine } from "./last-order";
import type { LastOrder } from "./last-order";

/** Stripe's message can land a few seconds after the shopper returns. Few tries, because each counts against the lookup limit. */
const LOOKUPS = 4;
const LOOKUP_GAP_MS = 3000;

/** The payment line of the order page. A card order is read from the server, so it says Paid only once it is. */
export function useOrderPaymentLine(summary: LastOrder | null): string | null {
  const transport = useOrderTransport();
  const [state, setState] = useState<{ paymentStatus: string | null; orderStatus: string | null }>({ paymentStatus: null, orderStatus: null });
  const orderId = summary?.orderId ?? null;
  const phone = summary?.whatsapp ?? null;
  const isCard = summary?.paymentMethod === "card";

  useEffect(() => {
    if (!isCard || orderId === null || phone === null) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const look = async (triesLeft: number): Promise<void> => {
      const order = await transport.lookupOrder({ orderId, phone }).catch(() => null);
      if (!current) return;
      if (order) setState({ paymentStatus: order.paymentStatus, orderStatus: order.status });
      const settled = order !== null && (order.paymentStatus === "paid" || order.status === "cancelled");
      if (!settled && triesLeft > 1) timer = setTimeout(() => void look(triesLeft - 1), LOOKUP_GAP_MS);
    };
    void look(LOOKUPS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [transport, orderId, phone, isCard]);

  return paymentLine(summary?.paymentMethod, state.paymentStatus, state.orderStatus);
}
