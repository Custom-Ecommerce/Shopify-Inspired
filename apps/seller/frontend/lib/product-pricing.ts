/**
 * The saving as a whole percent of the compare-at price, for the live preview in the product form. A local copy: this
 * app cannot import @markaz/platform-kit. Keep it in step with discountPercent in packages/platform-kit/src/commerce.ts.
 */
export function discountPercent(price: number, compareAt: number | null): number {
  if (compareAt === null) return 0;
  if (!Number.isFinite(price) || !Number.isFinite(compareAt) || price < 0 || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
