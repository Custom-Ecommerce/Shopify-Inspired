"use client";

import { useEffect, useMemo, useState } from "react";
import { cartLineNotice, checkoutBlockReason, compareCartToQuote } from "../view-models/cart-quote";
import type { CartLineNotice } from "../view-models/cart-quote";
import { useCart } from "./use-cart";
import { useCartQuote } from "./use-cart-quote";

export interface UseCartCheckResult {
  /** Changed prices and products gone, to tell the shopper once. */
  notices: string[];
  /** The flag for one cart line, by its variant id: sold out, too few left, gone, or "Only N left". */
  noticeFor: (variantId: string) => CartLineNotice | null;
  /** Why the cart cannot go to checkout as it stands, in words for the button. Null when it can. */
  blockReason: string | null;
}

/**
 * Checks the cart against the server each time it opens. A changed price is told once and the cart then shows the new one.
 * Nothing is asked while the cart is closed.
 */
export function useCartCheck(isOpen: boolean): UseCartCheckResult {
  const { quote } = useCartQuote({ enabled: isOpen });
  const { lines, applyQuotedPrices } = useCart();
  const [notices, setNotices] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) setNotices([]);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || quote === null) return;
    const changes = compareCartToQuote(lines, quote);
    if (changes.notices.length > 0) setNotices((previous) => [...new Set([...previous, ...changes.notices])]);
    if (changes.prices.length > 0) applyQuotedPrices(changes.prices);
    // Only a new answer from the server is news: the prices written above change `lines`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, isOpen]);

  return useMemo(() => {
    const byVariant = new Map((quote?.lines ?? []).map((line) => [String(line.variantId).toLowerCase(), line]));
    return {
      notices,
      noticeFor: (variantId: string) => {
        const line = byVariant.get(variantId.toLowerCase());
        return line ? cartLineNotice(line) : null;
      },
      blockReason: isOpen && quote ? checkoutBlockReason(lines, quote) : null,
    };
  }, [quote, notices, isOpen, lines]);
}
