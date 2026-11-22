import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";

/**
 * Sprint 8 (S8-B1, D-118): the tax line of a cart, a checkout or an order, as a shopper reads it. Pure. The amount and mode come from the server (the quote, or the
 * order's own snapshot); nothing is calculated here. An exclusive tax is added to the total and reads as the store's label ("Tax"); an inclusive tax is already inside
 * the prices and reads "Tax (included)". No line at all when there is no tax (the amount is 0), so a store with tax off shows nothing new.
 */

export type TaxMode = "exclusive" | "inclusive";

export const DEFAULT_TAX_LABEL = "Tax";

export interface TaxLineInput {
  taxAmount?: number | null;
  taxMode?: TaxMode | null;
  taxLabel?: string | null;
}

export interface TaxLineVM {
  /** "Tax" or the store's own name for it; "(included)" is added for an inclusive tax. */
  label: string;
  amount: Money;
  mode: TaxMode;
  /** True when the prices already contain it (the total does not include it a second time). */
  included: boolean;
}

/** The label of the tax line: the store's name (default "Tax"), with " (included)" for an inclusive tax. */
export function taxLineLabel(label: string | null | undefined, mode: TaxMode | null | undefined): string {
  const name = typeof label === "string" && label.trim() !== "" ? label.trim() : DEFAULT_TAX_LABEL;
  return mode === "inclusive" ? name + " (included)" : name;
}

/** The tax line to show, or null when there is none to show (tax off, an order from before tax, or a tax of 0). */
export function toTaxLine(input: TaxLineInput | null | undefined): TaxLineVM | null {
  const amount = typeof input?.taxAmount === "number" && Number.isFinite(input.taxAmount) ? Math.round(input.taxAmount) : 0;
  if (amount <= 0) return null;
  const mode: TaxMode = input?.taxMode === "inclusive" ? "inclusive" : "exclusive";
  return { label: taxLineLabel(input?.taxLabel, mode), amount: toMoney(amount), mode, included: mode === "inclusive" };
}
