/** Money is whole rupees: "Rs 1,234". Written by hand so every phone shows the same text. */
export function formatRupees(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'Rs -';
  const rounded = Math.round(amount);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}Rs ${digits}`;
}
