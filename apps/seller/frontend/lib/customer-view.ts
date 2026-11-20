/*
 * Sprint 5 EP-10.US02: the pure rules of the Customers pages (query text, links, tag input). Local to this app, which imports
 * @markaz/contracts as types only. Checked by lib/customer-view.check.ts.
 */

export type CustomerSortValue = "last_order" | "total_spent" | "orders";

export interface CustomerFilters {
  q: string;
  sort: CustomerSortValue;
  repeat: boolean;
  hasEmail: boolean;
  unsubscribed: boolean;
}

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilters = { q: "", sort: "last_order", repeat: false, hasEmail: false, unsubscribed: false };

export const CUSTOMER_PAGE_SIZE = 20;
export const NOTE_MAX = 500;
export const TAG_MAX = 20;
export const TAGS_MAX_COUNT = 5;

export const SORT_OPTIONS: ReadonlyArray<{ value: CustomerSortValue; label: string }> = [
  { value: "last_order", label: "Latest order" },
  { value: "total_spent", label: "Most spent" },
  { value: "orders", label: "Most orders" },
];

/** The filters as a query string for the list and the CSV export (no leading "?", only what differs from the default). */
export function filterQuery(filters: CustomerFilters, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  const q = filters.q.trim();
  if (q !== "") params.set("q", q);
  if (filters.sort !== "last_order") params.set("sort", filters.sort);
  if (filters.repeat) params.set("repeat", "1");
  if (filters.hasEmail) params.set("hasEmail", "1");
  if (filters.unsubscribed) params.set("unsubscribed", "1");
  return params.toString();
}

/** The path of a customer's page. The key is a phone (+923...) or an email, so it is always encoded. */
export function customerPath(storeBase: string, key: string): string {
  return `${storeBase}/customers/${encodeURIComponent(key)}`;
}

/** A phone for people: +923001234567 becomes 0300 1234567. Anything else is shown as it is. */
export function displayPhone(phone: string | null): string {
  if (phone === null) return "";
  const match = /^\+923(\d{2})(\d{7})$/.exec(phone);
  return match ? `03${match[1]} ${match[2]}` : phone;
}

/** The text on a customer's card or row when there is no name. */
export function displayName(name: string | null, phone: string | null, email: string | null): string {
  return name?.trim() || displayPhone(phone) || email || "Customer";
}

/**
 * The tags field is one text box: tags separated by commas. Trims, drops empties, drops a repeat in another letter case and
 * cuts to the limits, the same rules the server applies (it refuses what is still over).
 */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of input.split(",")) {
    const tag = part.replace(/\s+/g, " ").trim();
    if (tag === "" || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags;
}

/** The problem with a note or tags before it is sent, or null when the server would take it. */
export function noteProblem(note: string, tags: readonly string[]): string | null {
  if (note.length > NOTE_MAX) return `The note can be at most ${NOTE_MAX} characters.`;
  if (/[<>]/.test(note)) return "The note cannot contain < or >.";
  if (tags.length > TAGS_MAX_COUNT) return `Use at most ${TAGS_MAX_COUNT} tags.`;
  const long = tags.find((tag) => tag.length > TAG_MAX);
  if (long !== undefined) return `A tag can be at most ${TAG_MAX} characters.`;
  if (tags.some((tag) => /[<>]/.test(tag))) return "A tag cannot contain < or >.";
  return null;
}
