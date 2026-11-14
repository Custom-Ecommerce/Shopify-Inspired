import { STOCK_WARNING_THRESHOLD } from "@markaz/contracts/checkout";
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
  /** The price now. Null when the product is gone. */
  unitPrice: Money | null;
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
      unitPrice: line.unitPrice === null ? null : toMoney(line.unitPrice),
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

export interface CartLineNotice {
  /** blocked lines stop checkout. A warning does not. */
  tone: "warning" | "blocked";
  text: string;
}

/** What to say on one cart line, or null when there is nothing to say. */
export function cartLineNotice(line: CartQuoteLineVM): CartLineNotice | null {
  if (line.issue === "unknown_product") return { tone: "blocked", text: "No longer available" };
  if (line.issue === "out_of_stock") return { tone: "blocked", text: "Sold out" };
  if (line.issue === "insufficient_stock") return { tone: "blocked", text: "Only " + (line.availableQty ?? 0) + " available. Lower the quantity." };
  if (line.availableQty !== null && line.availableQty > 0 && line.availableQty <= STOCK_WARNING_THRESHOLD) return { tone: "warning", text: "Only " + line.availableQty + " left" };
  return null;
}

/** The part of a cart line these functions read. */
type CartLineRef = { id: string; variantId: string; title: string; unitPrice: Money };

const quotedLine = (quote: CartQuoteVM, variantId: string): CartQuoteLineVM | undefined =>
  quote.lines.find((line) => line.variantId?.toLowerCase() === variantId.toLowerCase());

export interface CartQuoteChanges {
  /** Lines whose price is not the one remembered, with the price now. */
  prices: Array<{ lineId: string; unitPrice: number }>;
  /** Plain sentences for the shopper. */
  notices: string[];
}

/** What has changed since these lines were added to the cart. */
export function compareCartToQuote(lines: readonly CartLineRef[], quote: CartQuoteVM): CartQuoteChanges {
  const changes: CartQuoteChanges = { prices: [], notices: [] };
  for (const line of lines) {
    const quoted = quotedLine(quote, line.variantId);
    if (!quoted) continue;
    if (quoted.issue === "unknown_product") {
      changes.notices.push(line.title + " is no longer available.");
    } else if (quoted.unitPrice !== null && quoted.unitPrice.amount !== line.unitPrice.amount) {
      changes.prices.push({ lineId: line.id, unitPrice: quoted.unitPrice.amount });
      changes.notices.push("The price of " + line.title + " changed from " + line.unitPrice.formatted + " to " + quoted.unitPrice.formatted + ".");
    }
  }
  return changes;
}

/** Why this cart cannot be ordered as it stands, for the checkout button. Null when it can. */
export function checkoutBlockReason(lines: readonly CartLineRef[], quote: CartQuoteVM): string | null {
  for (const line of lines) {
    const quoted = quotedLine(quote, line.variantId);
    if (quoted?.issue === "unknown_product") return line.title + " is no longer available. Remove it to continue.";
    if (quoted?.issue === "out_of_stock") return line.title + " is sold out. Remove it to continue.";
    if (quoted?.issue === "insufficient_stock") return "Only " + (quoted.availableQty ?? 0) + " of " + line.title + " left. Lower the quantity to continue.";
  }
  return null;
}
