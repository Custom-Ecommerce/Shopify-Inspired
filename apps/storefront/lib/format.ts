const pkrFormatter = new Intl.NumberFormat("en-US");

/** Whole rupees for display, e.g. 2500 becomes "Rs 2,500". */
export function formatPKR(amount: number): string {
  return `Rs ${pkrFormatter.format(amount)}`;
}
