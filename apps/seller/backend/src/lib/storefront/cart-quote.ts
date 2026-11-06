import { computeTotals, roundMoney } from './pricing';
import type { PricingStore } from './pricing';

/*
 * Cart quote, pure. Prices a cart from catalog rows the caller has already read. It reads no database and moves no
 * stock, so a quote can be asked as often as the cart changes. Order placement uses the same stock and pricing rules,
 * which keeps the total a shopper sees in the cart the total they are charged.
 */

export type QuoteIssue = 'unknown_product' | 'out_of_stock' | 'insufficient_stock';

export interface QuoteRequestLine {
  productId: string;
  qty: number;
}

/** A catalog row as the quote reads it. Only published products of the store reach this function. */
export interface QuoteCatalogRow {
  title: string;
  price: number;
  deliveryCharge: number | null;
  stockQuantity: number | null;
  reservedQuantity: number | null;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
}

export interface QuoteLine {
  productId: string;
  title: string | null;
  unitPrice: number | null;
  qty: number;
  lineTotal: number | null;
  issue: QuoteIssue | null;
  availableQty: number | null;
}

export interface CartQuote {
  lines: QuoteLine[];
  subtotal: number;
  deliveryCharges: number;
  total: number;
  canCheckout: boolean;
}

function usablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Lines that cannot be bought carry an issue and are left out of the totals. The same rule the order uses: a product is
 * out of stock when its status says so or when the free units cannot cover the quantity.
 */
export function buildCartQuote(
  requested: readonly QuoteRequestLine[],
  catalog: ReadonlyMap<string, QuoteCatalogRow>,
  store: PricingStore,
): CartQuote {
  const pricing: Array<{ unitPrice: number; qty: number; deliveryCharge: number | null }> = [];

  const lines = requested.map((line): QuoteLine => {
    const row = catalog.get(line.productId);
    if (!row || !usablePrice(row.price)) {
      return {
        productId: line.productId,
        title: null,
        unitPrice: null,
        qty: line.qty,
        lineTotal: null,
        issue: 'unknown_product',
        availableQty: null,
      };
    }
    const available = Math.max(0, (row.stockQuantity ?? 0) - (row.reservedQuantity ?? 0));
    const base = { productId: line.productId, title: row.title, unitPrice: row.price, qty: line.qty };
    if (row.stockStatus === 'out_of_stock') {
      return { ...base, lineTotal: null, issue: 'out_of_stock', availableQty: available };
    }
    if (available < line.qty) {
      return { ...base, lineTotal: null, issue: 'insufficient_stock', availableQty: available };
    }
    pricing.push({ unitPrice: row.price, qty: line.qty, deliveryCharge: row.deliveryCharge });
    return { ...base, lineTotal: roundMoney(row.price * line.qty), issue: null, availableQty: available };
  });

  const totals = computeTotals(pricing, store);
  const canCheckout = lines.length > 0 && lines.every((line) => line.issue === null);
  return {
    lines,
    subtotal: totals.subtotal,
    deliveryCharges: totals.deliveryCharges,
    total: totals.total,
    canCheckout,
  };
}

/**
 * Merges repeated products into one line with the summed quantity, as the order does, so a quote and an order judge
 * stock the same way. Keys are lower-cased ids, matching the catalog lookup.
 */
export function mergeQuoteLines(lines: readonly QuoteRequestLine[]): QuoteRequestLine[] {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const id = line.productId.toLowerCase();
    merged.set(id, (merged.get(id) ?? 0) + line.qty);
  }
  return [...merged.entries()].map(([productId, qty]) => ({ productId, qty }));
}
