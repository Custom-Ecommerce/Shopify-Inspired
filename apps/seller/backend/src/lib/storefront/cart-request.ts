import { STOREFRONT_ORDER_MAX_QTY, storefrontCartQuoteRequestSchema } from '@/lib/contracts';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { mergeQuoteLines, type QuoteRequestLine } from '@/lib/storefront/cart-quote';
import { invalidBody } from '@/lib/storefront/order-request';

const invalidQuantity = (productId: string, field: string): StorefrontHttpError =>
  new StorefrontHttpError(400, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 to ' + STOREFRONT_ORDER_MAX_QTY + '.', { productId, field });

/** Validates a quote body. A bad quantity is INVALID_QUANTITY with the product id and field, as on an order, and so is a repeated line that adds up past the limit. */
export function parseCartQuoteRequest(body: unknown): { lines: QuoteRequestLine[]; discountCode: string | null; city: string | null } {
  const parsed = storefrontCartQuoteRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error);
  for (const [index, line] of parsed.data.lines.entries()) {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > STOREFRONT_ORDER_MAX_QTY) throw invalidQuantity(line.productId, 'lines.' + index + '.qty');
  }
  const lines = mergeQuoteLines(parsed.data.lines);
  for (const line of lines) {
    if (line.qty > STOREFRONT_ORDER_MAX_QTY) throw invalidQuantity(line.productId, 'lines');
  }
  return { lines, discountCode: parsed.data.discountCode || null, city: parsed.data.city || null };
}
