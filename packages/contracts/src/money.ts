import { z } from 'zod';

/** Prices are whole rupees (D-004). Anything above this is a typing mistake, not a price. */
export const PRICE_MAX_PKR = 100_000_000;

/**
 * The one place a seller's number becomes a price: rounded to the nearest rupee. Returns null for anything that cannot
 * be a price, so a negative, NaN, Infinity, or absurdly large value is refused rather than rounded into something valid.
 */
export function toWholeRupees(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > PRICE_MAX_PKR) return null;
  return Math.round(value);
}

/** The one place the compare-at rule lives. Returns what is wrong, or null. It is never silently dropped. */
export function compareAtPriceProblem(price: number, compareAtPrice: number | null | undefined): string | null {
  if (compareAtPrice === null || compareAtPrice === undefined) return null;
  return compareAtPrice > price ? null : 'The compare-at price must be higher than the price.';
}

const rupeesProblem = 'Enter an amount from 0 to ' + PRICE_MAX_PKR + ' rupees.';

/** A price a seller sends. Decimals are accepted and rounded before anything else looks at the value. */
export const rupeesInputSchema = z.number().transform((value, context) => {
  const rupees = toWholeRupees(value);
  if (rupees === null) {
    context.addIssue({ code: 'custom', message: rupeesProblem });
    return z.NEVER;
  }
  return rupees;
});

/** A price as it is stored and returned: whole rupees, never a decimal. */
export const wholeRupeesSchema = z.number().int().min(0).max(PRICE_MAX_PKR);
