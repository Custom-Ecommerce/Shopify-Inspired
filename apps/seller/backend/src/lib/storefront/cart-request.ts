import { STOREFRONT_ORDER_MAX_QTY, storefrontCartQuoteRequestSchema } from '@/lib/contracts';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { mergeQuoteLines, type QuoteRequestLine } from '@/lib/storefront/cart-quote';

const invalid = (message: string): StorefrontHttpError => new StorefrontHttpError(400, 'INVALID_REQUEST', message);

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request.';
  const path = issue.path.map(String).join('.');
  return path ? path + ': ' + issue.message : issue.message;
}

/** Validates a quote body. A bad quantity is INVALID_QUANTITY with the product id, the same as an order. */
export function parseCartQuoteRequest(body: unknown): { lines: QuoteRequestLine[] } {
  const parsed = storefrontCartQuoteRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid(firstIssue(parsed.error));
  for (const line of parsed.data.lines) {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > STOREFRONT_ORDER_MAX_QTY) {
      throw new StorefrontHttpError(400, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 to ' + STOREFRONT_ORDER_MAX_QTY + '.', {
        productId: line.productId,
      });
    }
  }
  return { lines: mergeQuoteLines(parsed.data.lines) };
}
