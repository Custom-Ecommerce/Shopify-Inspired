import {
  PAKISTAN_CITIES,
  STORE_SEO_DESCRIPTION_MAX,
  STORE_SEO_TITLE_MAX,
  cityKey,
  cityRateMap,
  maskAccountNumber,
  quoteDelivery,
  type DeliveryQuote,
  type StoreSettings,
} from "@markaz/contracts/store-settings";

/**
 * Pure helpers of the store settings screen (Sprint 4 SB-5): what changed, the quote preview, the city search and the
 * character counters. No React and no fetch, so they can be tested alone.
 */

export { PAKISTAN_CITIES, STORE_SEO_DESCRIPTION_MAX, STORE_SEO_TITLE_MAX, maskAccountNumber };

/** Stable text of a value, with object keys sorted, so two equal forms compare equal whatever order they were built in. */
export function stableText(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableText).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableText(record[key])).join(",") + "}";
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** True when the form differs from what was last saved. */
export function isDirty(saved: unknown, current: unknown): boolean {
  return stableText(saved) !== stableText(current);
}

/** The keys of `current` whose value differs from `saved`: the fields a PATCH group has to carry. */
export function changedFields<T extends Record<string, unknown>>(saved: T, current: T): Array<keyof T> {
  return (Object.keys(current) as Array<keyof T>).filter((key) => isDirty(saved[key], current[key]));
}

/** The group body of a PATCH: only the changed fields, or null when nothing changed. */
export function groupPatch<T extends Record<string, unknown>>(saved: T, current: T): Partial<T> | null {
  const keys = changedFields(saved, current);
  if (keys.length === 0) return null;
  const body: Partial<T> = {};
  for (const key of keys) body[key] = current[key];
  return body;
}

/** The characters left of a limit, and whether the text is over it. */
export function counter(text: string, max: number): { used: number; left: number; over: boolean } {
  const used = text.length;
  return { used, left: max - used, over: used > max };
}

/** The list cities matching what was typed (case, spaces and dots do not matter), the best matches first, at most `limit`. */
export function searchCities(query: string, limit = 8, taken: ReadonlyArray<string> = []): string[] {
  const needle = cityKey(query);
  const used = new Set(taken.map(cityKey));
  const available = PAKISTAN_CITIES.filter((city) => !used.has(cityKey(city)));
  if (needle === "") return available.slice(0, limit);
  const starts = available.filter((city) => cityKey(city).startsWith(needle));
  const inside = available.filter((city) => !cityKey(city).startsWith(needle) && cityKey(city).includes(needle));
  return [...starts, ...inside].slice(0, limit);
}

export interface DeliveryDraft {
  defaultRate: number;
  freeOver: number | null;
  cityRates: Array<{ city: string; rate: number }>;
}

/** What a shopper in `city` would pay for one item costing `itemTotal`: the same function the server prices checkout with. */
export function quotePreview(draft: DeliveryDraft, city: string | null, itemTotal: number): DeliveryQuote {
  return quoteDelivery({
    defaultRate: draft.defaultRate,
    freeOver: draft.freeOver,
    cityRates: cityRateMap(draft.cityRates),
    city,
    itemsAfterDiscount: itemTotal,
  });
}

/** A whole-rupee number typed in a field: empty is null, anything else that is not a whole number 0 or more is NaN. */
export function parseRupees(text: string): number | null {
  const clean = text.replace(/[,\s]/g, "");
  if (clean === "") return null;
  return /^\d{1,6}$/.test(clean) ? Number(clean) : Number.NaN;
}

/** Card and cash on delivery cannot both be off: true when switching `which` off would leave none. */
export function lastPaymentMethod(payments: { codEnabled: boolean; cardEnabled: boolean }, which: "codEnabled" | "cardEnabled"): boolean {
  const other = which === "codEnabled" ? payments.cardEnabled : payments.codEnabled;
  return payments[which] && !other;
}

/** The payout form is complete when the re-entered number equals the first and the other parts are filled. */
export function payoutProblem(input: { method: string; accountTitle: string; accountNumber: string; confirmNumber: string; bankName: string }): string | null {
  if (input.accountTitle.trim().length < 2) return "Enter the account title.";
  if (input.accountNumber.trim() === "") return "Enter the account number.";
  const norm = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();
  if (norm(input.accountNumber) !== norm(input.confirmNumber)) return "The two account numbers are not the same.";
  if (input.method === "bank" && input.bankName.trim() === "") return "Enter the bank name.";
  return null;
}

/** The settings groups the form edits as plain values (empty text for an unset one), and back. */
export function textOf(value: string | null | undefined): string {
  return value ?? "";
}

export type SavedSettings = StoreSettings;

/** The saved link of a media record, or null. */
export function mediaUrl(media: { url: string | null } | null | undefined): string | null {
  return media?.url ?? null;
}
