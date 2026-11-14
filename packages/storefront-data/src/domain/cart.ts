export interface CartLine {
  /** One line per variant, so the line id is the variant id. */
  id: string;
  productId: string;
  variantId: string;
  /** Null for a product with no options. */
  variantTitle: string | null;
  slug: string;
  title: string;
  image: { url: string; alt: string } | null;
  /** Price snapshot in PKR. The server re-prices at checkout, so this is display-only. */
  unitPrice: number;
  qty: number;
}

export interface CartableProduct {
  id: string;
  variantId: string;
  variantTitle: string | null;
  slug: string;
  title: string;
  image: { url: string; alt: string } | null;
  unitPrice: number;
}

export const MAX_LINE_QTY = 99;

/** The most lines a cart holds, which is also the most an order takes. Keeps what is stored in the browser small. */
export const MAX_CART_LINES = 50;

export function normaliseQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.min(MAX_LINE_QTY, Math.max(1, Math.floor(qty)));
}

export function addCartLine(lines: CartLine[], item: CartableProduct, qty: number): CartLine[] {
  const amount = normaliseQty(qty);
  const existing = lines.find((line) => line.id === item.variantId);
  if (!existing) {
    if (lines.length >= MAX_CART_LINES) return lines;
    return [
      ...lines,
      {
        id: item.variantId,
        productId: item.id,
        variantId: item.variantId,
        variantTitle: item.variantTitle,
        slug: item.slug,
        title: item.title,
        image: item.image,
        unitPrice: item.unitPrice,
        qty: amount,
      },
    ];
  }
  return lines.map((line) =>
    line.id === item.variantId
      ? { ...line, unitPrice: item.unitPrice, qty: normaliseQty(line.qty + amount) }
      : line,
  );
}

/** Writes the server's current prices over the ones remembered when each line was added. */
export function applyLinePrices(lines: CartLine[], prices: ReadonlyArray<{ lineId: string; unitPrice: number }>): CartLine[] {
  const byLine = new Map(prices.map((price) => [price.lineId, price.unitPrice]));
  return lines.map((line) => (byLine.has(line.id) ? { ...line, unitPrice: byLine.get(line.id) as number } : line));
}

export function removeCartLine(lines: CartLine[], lineId: string): CartLine[] {
  return lines.filter((line) => line.id !== lineId);
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.qty, 0);
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.unitPrice * line.qty, 0);
}

/**
 * Sets one line's quantity. Quantities are whole numbers capped at MAX_LINE_QTY, and a quantity below 1 removes the
 * line. A quantity that is not a finite number leaves the cart as it is, and so does a line that is not in the cart.
 */
export function setCartLineQty(lines: CartLine[], lineId: string, qty: number): CartLine[] {
  if (!Number.isFinite(qty)) return lines;
  const whole = Math.floor(qty);
  if (whole < 1) return removeCartLine(lines, lineId);
  return lines.map((line) => (line.id === lineId ? { ...line, qty: Math.min(MAX_LINE_QTY, whole) } : line));
}
