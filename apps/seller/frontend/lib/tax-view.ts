import { TAX_LABEL_DEFAULT, TAX_LABEL_MAX, TAX_RATE_MAX, rateInHundredths, taxAmountOf, type TaxMode } from "@markaz/contracts/tax";
import { stableText } from "./store-settings-form";

/**
 * Sprint 8 (S8-B1, D-118): the Tax tab of the store settings. Pure: the form state, what a typed rate means, what changed, the PATCH body and the worked
 * example. No React and no fetch. The server validates every field again; nothing here is trusted. Tax is PKR only, OFF by default, ONE rate, whole rupees.
 */

export { TAX_LABEL_DEFAULT, TAX_LABEL_MAX, TAX_RATE_MAX };

/** The sentence under the form. Markazify does not know the seller's tax rules; it calculates what the seller enters. */
export const TAX_NOTE = "Check your own tax rules; Markazify only calculates what you enter.";

/** What the settings answer carries (GET .../settings and the PATCH answer): the tax with the defaults filled in. */
export interface TaxRead {
  enabled: boolean;
  ratePercent: number;
  mode: TaxMode;
  label: string;
}

/** The form: the rate as typed (checked live), the label as typed. */
export interface TaxForm {
  enabled: boolean;
  rate: string;
  mode: TaxMode;
  label: string;
}

export const MODE_COPY: Record<TaxMode, { name: string; help: string }> = {
  exclusive: { name: "Added on top of the prices", help: "Your prices are before tax. The tax is added at checkout." },
  inclusive: { name: "Already included in the prices", help: "Your prices already contain the tax. The tax is worked out and shown, and the total does not change." },
};

/** The form for a settings answer. An older backend without tax gives the defaults (off). A rate that was never set shows empty. */
export function formFromTax(read: TaxRead | null | undefined): TaxForm {
  if (!read) return { enabled: false, rate: "", mode: "exclusive", label: TAX_LABEL_DEFAULT };
  return {
    enabled: read.enabled === true,
    rate: read.enabled === true || read.ratePercent > 0 ? String(read.ratePercent) : "",
    mode: read.mode === "inclusive" ? "inclusive" : "exclusive",
    label: typeof read.label === "string" && read.label.trim() !== "" ? read.label : TAX_LABEL_DEFAULT,
  };
}

/** The typed rate as a number, or null when it is not a rate: digits with at most 2 decimals, from 0 to 100. */
export function parseRate(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const value = Number(clean);
  return value <= TAX_RATE_MAX && rateInHundredths(value) !== null ? value : null;
}

/** What is wrong with the typed rate, or null. An empty rate is a problem only while tax is on (it is then required). */
export function rateProblem(text: string, enabled: boolean): string | null {
  const clean = text.trim();
  if (clean === "") return enabled ? "Enter the tax rate to turn tax on." : null;
  if (/^-/.test(clean)) return "The tax rate cannot be negative.";
  if (/^\d+\.\d{3,}$/.test(clean)) return "The tax rate can have at most 2 decimals.";
  if (parseRate(clean) === null) return Number(clean) > TAX_RATE_MAX ? "The tax rate can be at most " + TAX_RATE_MAX + "%." : "Enter a rate like 17 or 17.5.";
  return null;
}

/** What is wrong with the typed name, or null. */
export function labelProblem(text: string): string | null {
  const clean = text.trim();
  if (clean === "") return "Enter a name for the tax, for example Tax or GST.";
  if (clean.length > TAX_LABEL_MAX) return "The name can be at most " + TAX_LABEL_MAX + " characters.";
  if (/[<>]/.test(clean)) return "The name cannot contain < or >.";
  return null;
}

/** Problems by the field name the server uses (tax.ratePercent, tax.label), so the form shows them the way a server answer is shown. */
export function taxProblems(form: TaxForm): Record<string, string> {
  const out: Record<string, string> = {};
  const rate = rateProblem(form.rate, form.enabled);
  if (rate !== null) out["tax.ratePercent"] = rate;
  const label = labelProblem(form.label);
  if (label !== null) out["tax.label"] = label;
  return out;
}

/** What is saved of a form, comparable: the rate as a number, the label trimmed. */
function comparable(form: TaxForm): Record<string, unknown> {
  return { enabled: form.enabled, rate: form.rate.trim() === "" ? null : parseRate(form.rate) ?? form.rate.trim(), mode: form.mode, label: form.label.trim() };
}

export const isTaxDirty = (saved: TaxForm, current: TaxForm): boolean => stableText(comparable(saved)) !== stableText(comparable(current));

/** The PATCH body: only the fields that changed (the group is partial), or null when nothing changed. The caller checks taxProblems first. */
export function taxBody(saved: TaxForm, current: TaxForm): { tax: Record<string, unknown> } | null {
  if (!isTaxDirty(saved, current)) return null;
  const tax: Record<string, unknown> = {};
  if (saved.enabled !== current.enabled) tax.enabled = current.enabled;
  const rate = parseRate(current.rate);
  if (rate !== null && rate !== parseRate(saved.rate)) tax.ratePercent = rate;
  if (saved.mode !== current.mode) tax.mode = current.mode;
  if (saved.label.trim() !== current.label.trim()) tax.label = current.label.trim();
  // Turning tax on always names its rate, so the server never has to guess it.
  if (current.enabled && rate !== null && tax.ratePercent === undefined && saved.enabled !== current.enabled) tax.ratePercent = rate;
  return Object.keys(tax).length === 0 ? null : { tax };
}

const rupees = (value: number): string => "Rs. " + value.toLocaleString("en-PK");

/** A worked example for the form ("Rs. 1,000 of items"), or null while the rate is not usable. It uses the same arithmetic as the order. */
export function taxExample(form: TaxForm, items = 1000): string | null {
  const rate = parseRate(form.rate);
  if (rate === null) return null;
  const tax = taxAmountOf(items, { enabled: true, ratePercent: rate, mode: form.mode });
  const name = form.label.trim() === "" ? TAX_LABEL_DEFAULT : form.label.trim();
  return form.mode === "inclusive"
    ? "Example: " + rupees(items) + " of items already contains " + rupees(tax) + " " + name + ". The total stays " + rupees(items) + " plus delivery."
    : "Example: " + rupees(items) + " of items gets " + rupees(tax) + " " + name + " added: " + rupees(items + tax) + " plus delivery.";
}

/** The name of the tax line on an order: the store's name for it, with "(included)" when the prices already contained the tax. */
export function taxRowLabel(label: string | null | undefined, mode: TaxMode | null | undefined, rate?: number | null): string {
  const name = typeof label === "string" && label.trim() !== "" ? label.trim() : TAX_LABEL_DEFAULT;
  const withRate = typeof rate === "number" && rate > 0 ? name + " " + rate + "%" : name;
  return mode === "inclusive" ? withRate + " (included)" : withRate;
}
