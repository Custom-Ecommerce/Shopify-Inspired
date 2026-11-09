import type { StorefrontCartQuoteDto, StorefrontCartQuoteIssue, StorefrontCartQuoteLine } from '@markaz/contracts';
import { toWholeRupees } from '@/lib/contracts';
import { StorefrontHttpError } from './errors';
import { computeTotals, roundMoney } from './pricing';
import type { PricingStore } from './pricing';
import { availabilityOf, canSupply, resolveVariant, unitsLeft, type CheckoutVariant } from './variant';

/*
 * Cart quote, pure. Prices a cart from catalog rows the caller has already read. It reads no database and moves no
 * stock, so a quote can be asked as often as the cart changes. Order placement uses the same stock and pricing rules,
 * which keeps the total a shopper sees in the cart the total they are charged.
 */

export type QuoteIssue = StorefrontCartQuoteIssue;

export interface QuoteRequestLine {
  productId: string;
  /** Null asks for the product's only variant. */
  variantId: string | null;
  qty: number;
}

/** A catalog row as the quote reads it. Only Live products of the store reach this function as rows. */
export interface QuoteCatalogRow {
  title: string;
  deliveryCharge: number | null;
  variants: CheckoutVariant[];
}

export type QuoteLine = StorefrontCartQuoteLine;

export type CartQuote = StorefrontCartQuoteDto;

interface ResolvedLine {
  productId: string;
  row: QuoteCatalogRow;
  variant: CheckoutVariant;
  /** Read from the catalog now, in whole rupees. Nothing the browser sent is involved. */
  unitPrice: number;
  qty: number;
}

/**
 * Lines that cannot be bought carry an issue and are left out of the totals. The same rule the order uses: a variant is
 * out of stock when it has no units, and short when its units cannot cover the quantity.
 *
 * A product with several variants and no variantId is a 422 VARIANT_REQUIRED, the answer an order gets, because the
 * cart has no way to price what it cannot name. A variantId that does not belong to the product is a line issue, since
 * a seller can delete a variant while it sits in a shopper's cart.
 *
 * `unavailable` holds the products of this store that exist but are not for sale (D-037): a draft, an unedited demo, or
 * one in trash. Their lines are refused with product_unavailable, and say nothing else about the product.
 */
export function buildCartQuote(
  requested: readonly QuoteRequestLine[],
  catalog: ReadonlyMap<string, QuoteCatalogRow>,
  store: PricingStore,
  unavailable: ReadonlySet<string> = new Set(),
): CartQuote {
  const pricing: Array<{ unitPrice: number; qty: number; deliveryCharge: number | null }> = [];

  // Asking for the Default variant by name and by omission is one variant, so stock is judged once for both.
  const resolved = new Map<string, ResolvedLine>();
  const lines: Array<QuoteLine | ResolvedLine> = [];

  for (const line of requested) {
    if (unavailable.has(line.productId)) {
      lines.push(refusal(line, null, 'product_unavailable'));
      continue;
    }
    const row = catalog.get(line.productId);
    if (!row) {
      lines.push(refusal(line, null, 'unknown_product'));
      continue;
    }
    const match = resolveVariant(row.variants, line.variantId);
    if (match.kind === 'variant_required') {
      throw new StorefrontHttpError(422, 'VARIANT_REQUIRED', 'Choose a variant of this product.', { productId: line.productId });
    }
    if (match.kind === 'unknown_variant') {
      lines.push(refusal(line, row.title, 'unknown_variant'));
      continue;
    }
    const unitPrice = toWholeRupees(match.variant.price);
    if (unitPrice === null) {
      lines.push(refusal(line, null, 'unknown_product'));
      continue;
    }
    const key = line.productId + '|' + String(match.variant._id).toLowerCase();
    const existing = resolved.get(key);
    if (existing) {
      existing.qty += line.qty;
      continue;
    }
    const entry: ResolvedLine = { productId: line.productId, row, variant: match.variant, unitPrice, qty: line.qty };
    resolved.set(key, entry);
    lines.push(entry);
  }

  const priced = lines.map((line): QuoteLine => {
    if (!('variant' in line)) return line;
    const { productId, row, variant, unitPrice, qty } = line;
    const base = {
      productId,
      variantId: String(variant._id),
      title: row.title,
      variantTitle: variant.title,
      unitPrice,
      qty,
      availableQty: unitsLeft(variant),
    };
    if (availabilityOf(variant) === 'out_of_stock') return { ...base, lineTotal: null, issue: 'out_of_stock' };
    if (!canSupply(variant, qty)) return { ...base, lineTotal: null, issue: 'insufficient_stock' };
    pricing.push({ unitPrice, qty, deliveryCharge: row.deliveryCharge });
    return { ...base, lineTotal: roundMoney(unitPrice * qty), issue: null };
  });

  const totals = computeTotals(pricing, store);
  const canCheckout = priced.length > 0 && priced.every((line) => line.issue === null);
  return { ...totals, lines: priced, canCheckout };
}

function refusal(line: QuoteRequestLine, title: string | null, issue: QuoteIssue): QuoteLine {
  return {
    productId: line.productId,
    variantId: line.variantId,
    title,
    variantTitle: null,
    unitPrice: null,
    qty: line.qty,
    lineTotal: null,
    issue,
    availableQty: null,
  };
}

/**
 * Merges repeated lines into one with the summed quantity, as the order does, so a quote and an order judge stock the
 * same way. Keys are lower-cased ids, matching the catalog lookup.
 */
export function mergeQuoteLines(lines: ReadonlyArray<{ productId: string; variantId?: string | null; qty: number }>): QuoteRequestLine[] {
  const merged = new Map<string, QuoteRequestLine>();
  for (const line of lines) {
    const productId = line.productId.toLowerCase();
    const variantId = line.variantId ? line.variantId.toLowerCase() : null;
    const key = productId + '|' + (variantId ?? '');
    const existing = merged.get(key);
    if (existing) existing.qty += line.qty;
    else merged.set(key, { productId, variantId, qty: line.qty });
  }
  return [...merged.values()];
}
