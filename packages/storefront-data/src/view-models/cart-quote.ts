import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";
import type { CartQuote, CartQuoteIssue } from "../transport/types";

export interface CartQuoteLineVM {
  productId: string;
  variantId: string | null;
  /** A variant gone, or a product no longer for sale, reads to a shopper like a product gone, so themes need no new case. */
  issue: Exclude<CartQuoteIssue, "unknown_variant" | "product_unavailable"> | null;
  /** Units that can still be bought, when the server knows them. */
  availableQty: number | null;
  lineTotal: Money | null;
}

export interface CartQuoteVM {
  lines: CartQuoteLineVM[];
  subtotal: Money;
  deliveryCharges: Money;
  discount: Money;
  total: Money;
  canCheckout: boolean;
  /** The code that made the discount. Null when none was sent or it was refused. */
  discountCode: string | null;
  /** The plain reason a code that was sent cannot be used. */
  discountError: string | null;
}

/** Formats the server's quote the same way as the cart's own totals, so the two read alike. */
export function toCartQuoteVM(quote: CartQuote): CartQuoteVM {
  return {
    lines: quote.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      issue: line.issue === "unknown_variant" || line.issue === "product_unavailable" ? "unknown_product" : line.issue,
      availableQty: line.availableQty,
      lineTotal: line.lineTotal === null ? null : toMoney(line.lineTotal),
    })),
    subtotal: toMoney(quote.subtotal),
    deliveryCharges: toMoney(quote.deliveryCharges),
    discount: toMoney(quote.discount),
    total: toMoney(quote.total),
    canCheckout: quote.canCheckout,
    discountCode: quote.discountCode,
    discountError: quote.discountError?.message ?? null,
  };
}
