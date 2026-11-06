import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";
import type { CartQuote, CartQuoteIssue } from "../transport/types";

export interface CartQuoteLineVM {
  productId: string;
  issue: CartQuoteIssue | null;
  /** Units that can still be bought, when the server knows them. */
  availableQty: number | null;
  lineTotal: Money | null;
}

export interface CartQuoteVM {
  lines: CartQuoteLineVM[];
  subtotal: Money;
  deliveryCharges: Money;
  total: Money;
  canCheckout: boolean;
}

/** Formats the server's quote the same way as the cart's own totals, so the two read alike. */
export function toCartQuoteVM(quote: CartQuote): CartQuoteVM {
  return {
    lines: quote.lines.map((line) => ({
      productId: line.productId,
      issue: line.issue,
      availableQty: line.availableQty,
      lineTotal: line.lineTotal === null ? null : toMoney(line.lineTotal),
    })),
    subtotal: toMoney(quote.subtotal),
    deliveryCharges: toMoney(quote.deliveryCharges),
    total: toMoney(quote.total),
    canCheckout: quote.canCheckout,
  };
}
