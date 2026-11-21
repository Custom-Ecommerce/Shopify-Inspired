import type { AbandonedCartItemView } from "@markaz/contracts";

/**
 * Sprint 5 EP-28.US01.T04 (D-107): the pure rules of the seller's Abandoned carts page. No React and no fetch, so they can be tested alone.
 */

export type CartTab = "open" | "contacted" | "recovered" | "all";

export const CART_TABS: ReadonlyArray<{ value: CartTab; label: string }> = [
  { value: "open", label: "Open" },
  { value: "contacted", label: "Contacted" },
  { value: "recovered", label: "Recovered" },
  { value: "all", label: "All" },
];

/** The list query. The tabs send ?status= (the backend reads exactly that); "all" sends none. */
export function cartListQuery(tab: CartTab, page = 1, limit = 20): string {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("status", tab);
  params.set("page", String(page));
  params.set("limit", String(limit));
  return params.toString();
}

/** "just now", "12 min ago", "3 h ago", "2 d ago": how long ago the shopper last had the cart open. */
export function minutesAgoText(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** One line per item: "Lawn suit (Blue) x 2". */
export function itemLine(item: Pick<AbandonedCartItemView, "productTitle" | "variantTitle" | "quantity">): string {
  const variant = item.variantTitle !== "" && item.variantTitle !== "Default" ? ` (${item.variantTitle})` : "";
  return `${item.productTitle}${variant} x ${item.quantity}`;
}

/**
 * The text of the wa.me message the seller sends from their own phone (D-091: no API): English, then Urdu. It names the store and the first items
 * and asks if the shopper needs help. Plain text; the link builder encodes it.
 */
export function cartWhatsappText(storeName: string, items: ReadonlyArray<Pick<AbandonedCartItemView, "productTitle" | "variantTitle" | "quantity">>): string {
  const shown = items.slice(0, 3).map(itemLine).join(", ");
  const more = items.length > 3 ? ` and ${items.length - 3} more` : "";
  return `Hi, this is ${storeName}. You left ${shown}${more} in your cart. Can we help you complete your order?\nالسلام علیکم، یہ ${storeName} ہے۔ آپ کی کارٹ میں سامان رہ گیا ہے۔ کیا ہم آرڈر مکمل کرنے میں مدد کریں؟`;
}

/** The text of a failed call, from the backend's error envelope, or the generic sentence. */
export function cartErrorText(body: unknown): string {
  const errors = (body as { errors?: Array<{ message?: unknown }> } | null)?.errors;
  const message = errors?.[0]?.message;
  return typeof message === "string" && message !== "" ? message : "Something went wrong. Please try again.";
}
