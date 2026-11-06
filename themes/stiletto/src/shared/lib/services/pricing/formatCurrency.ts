// ============================================================================
// formatCurrency
// ----------------------------------------------------------------------------
// Formats a store money amount + currency code into a display-ready price
// string. Extracted from the "Format Price" step of
// packages/store/src/utils/normalize.ts::normalizeProduct.
// ============================================================================

export function formatCurrency(amount: string, currencyCode: string): string {
  if (currencyCode === "PKR") {
    return `Rs. ${amount}`;
  }

  if (currencyCode === "USD") {
    return `$${amount}`;
  }

  return `${currencyCode} ${amount}`;
}
