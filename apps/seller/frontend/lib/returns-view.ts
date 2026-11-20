/*
 * Sprint 5 EP-13 (D-107, D-108): the pure rules of the seller's Returns page: the status tabs and their query, the forms' checks before
 * anything is sent, and the receive body. Local to this app, which imports @markaz/contracts as types only. Checked by test/returns-view.test.ts.
 */

export type ReturnStatusValue = "requested" | "approved" | "rejected" | "received" | "refunded" | "completed";
export type RefundMethodValue = "bank" | "jazzcash" | "easypaisa" | "cash";

export const RETURN_TABS: ReadonlyArray<{ value: ReturnStatusValue | "all"; label: string }> = [
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "received", label: "Received" },
  { value: "refunded", label: "Refunded" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export const RETURN_STATUS_LABEL: Record<ReturnStatusValue, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  received: "Received",
  refunded: "Refunded",
  completed: "Completed",
};

export const REASON_LABEL: Record<string, string> = {
  damaged: "Damaged or defective",
  wrong_item: "Wrong item received",
  changed_mind: "Changed my mind",
  other: "Other reason",
};

export const REFUND_METHOD_LABEL: Record<RefundMethodValue, string> = { bank: "Bank transfer", jazzcash: "JazzCash", easypaisa: "Easypaisa", cash: "Cash" };

export const REJECT_REASON_MIN = 5;
export const REJECT_REASON_MAX = 200;
export const REFERENCE_MAX = 100;

/** The list URL of a tab. The backend reads ?status= (the page used to send where[status][equals], which it never read). */
export function listQuery(tab: ReturnStatusValue | "all", page = 1, limit = 20): string {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("status", tab);
  params.set("page", String(page));
  params.set("limit", String(limit));
  return params.toString();
}

/** The problem with a rejection reason before it is sent, or null. */
export function rejectProblem(reason: string): string | null {
  const text = reason.replace(/\s+/g, " ").trim();
  if (text.length < REJECT_REASON_MIN) return `Write at least ${REJECT_REASON_MIN} characters, so the customer understands.`;
  if (text.length > REJECT_REASON_MAX) return `The reason can be at most ${REJECT_REASON_MAX} characters.`;
  if (/[<>]/.test(text)) return "The reason cannot contain < or >.";
  return null;
}

/** What is left to refund: the cap less what is recorded. Never below 0. */
export function refundLeft(cap: number | null, recorded: number): number {
  return cap === null ? 0 : Math.max(0, Math.round(cap) - Math.round(recorded));
}

/** The problem with a refund before it is sent (whole rupees, at least 1, at most what is left, a reference within its limit), or null. */
export function refundProblem(input: { amount: string; left: number; reference: string }): string | null {
  const text = input.amount.replace(/[,\s]/g, "");
  if (text === "") return "Enter the amount in whole rupees.";
  if (!/^\d{1,8}$/.test(text) || Number(text) < 1) return "Enter a whole number of rupees, at least 1.";
  if (Number(text) > input.left) return `At most Rs. ${input.left.toLocaleString("en-US")} can still be refunded.`;
  if (input.reference.length > REFERENCE_MAX) return `The reference can be at most ${REFERENCE_MAX} characters.`;
  if (/[<>]/.test(input.reference)) return "The reference cannot contain < or >.";
  return null;
}

export interface ReceiveRow {
  productId: string;
  variantId: string;
  /** What the return asked for: the most that can come back. */
  asked: number;
  /** What the seller says came back (text from the input). */
  quantity: string;
  restock: boolean;
}

/** The receive body from the form rows, or the problem. Rows with quantity 0 are left out; at least one row must have something. */
export function receiveBody(rows: ReadonlyArray<ReceiveRow>): { body: { items: Array<{ productId: string; variantId: string; quantity: number; restock: boolean }> } | null; problem: string | null } {
  const items: Array<{ productId: string; variantId: string; quantity: number; restock: boolean }> = [];
  for (const row of rows) {
    const text = row.quantity.trim();
    if (text === "" || text === "0") continue;
    if (!/^\d{1,2}$/.test(text)) return { body: null, problem: "Enter whole numbers for the quantities." };
    const quantity = Number(text);
    if (quantity > row.asked) return { body: null, problem: `At most ${row.asked} of an item can come back.` };
    items.push({ productId: row.productId, variantId: row.variantId, quantity, restock: row.restock });
  }
  if (items.length === 0) return { body: null, problem: "Enter how many of at least one item came back." };
  return { body: { items }, problem: null };
}

/** The first receive form: every line at the quantity asked for, to be put back on the shelf. */
export function defaultReceiveRows(items: ReadonlyArray<{ productId: string; variantId: string; quantity: number }>): ReceiveRow[] {
  return items.map((item) => ({ productId: item.productId, variantId: item.variantId, asked: item.quantity, quantity: String(item.quantity), restock: true }));
}

/** The words for a 409/422/404 of a return action. */
export function returnErrorText(status: number, code: string | null): string {
  if (status === 409) return "This return was changed (maybe in another tab). It has been refreshed.";
  if (status === 404) return "This return was not found in your store.";
  if (code === "CARD_REFUND_UNSUPPORTED") return "Refunds of card orders are not supported yet.";
  if (code === "REFUND_EXCEEDS_CAP") return "That is more than what is left to refund on this return.";
  return "It could not be saved. Check your connection and try again.";
}

/** The problem with the return window (whole days from 0 to 30) before it is sent, or null. */
export function returnWindowProblem(text: string): string | null {
  const clean = text.trim();
  if (!/^\d{1,2}$/.test(clean)) return "Enter a whole number of days from 0 to 30.";
  return Number(clean) > 30 ? "The return window can be at most 30 days." : null;
}
