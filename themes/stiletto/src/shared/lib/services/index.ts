// ============================================================================
// the model — master barrel
// ----------------------------------------------------------------------------
// Single import surface for shared, pure business-logic utilities extracted
// out of app/theme components and the store integration package.
//
//   import { formatPhoneNumber, calculateReviewSummary, formatCurrency }
//     from "./";
// ============================================================================

export * from "./orders/formatPhoneNumber";
export * from "./reviews/calculateReviewSummary";
export * from "./pricing/formatCurrency";
