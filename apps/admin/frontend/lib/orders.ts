import type { AdminOrderDetail, AdminOrderRow } from "@/lib/contracts";
import { formatRs, methodLabel as _unused } from "@/lib/subscription-payments";

/**
 * Sprint 6 EP-12 (S6-B5): the read-only Orders page. Pure helpers: the list state in the URL, the API query, labels. The orders carry SAFE fields
 * only (the backend never sends a name, phone, address or email). Money is whole rupees.
 */
void _unused;

export const ORDER_PAGE_SIZE = 20;
export const ORDER_STATUS_VALUES = ["pending", "confirmed", "processing", "dispatched", "delivered", "cancelled", "returned"] as const;
export type OrderStatusValue = (typeof ORDER_STATUS_VALUES)[number];

export interface OrderListState {
  page: number;
  status: OrderStatusValue | "";
  store: string;
  from: string;
  to: string;
  q: string;
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Anything unreadable falls back to the default, so a hand-edited URL never breaks the page. */
export function parseOrderListState(params: { get(name: string): string | null }): OrderListState {
  const rawPage = params.get("page") ?? "";
  const status = ORDER_STATUS_VALUES.find((value) => value === params.get("status")) ?? "";
  const store = (params.get("store") ?? "").trim();
  const from = (params.get("from") ?? "").trim();
  const to = (params.get("to") ?? "").trim();
  return {
    page: /^\d{1,6}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1,
    status,
    store: OBJECT_ID.test(store) ? store : "",
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    q: (params.get("q") ?? "").trim().slice(0, 40),
  };
}

/** The query string for a list state. Defaults are left out; the API call adds the page size. */
export function orderStateToQuery(state: OrderListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.status !== "") params.set("status", state.status);
  if (state.store !== "") params.set("store", state.store);
  if (state.from !== "") params.set("from", state.from);
  if (state.to !== "") params.set("to", state.to);
  if (state.q !== "") params.set("q", state.q);
  if (withLimit) params.set("limit", String(ORDER_PAGE_SIZE));
  return params.toString();
}

/** True when a date range is backwards (the page says so instead of asking the backend). */
export function rangeProblem(state: Pick<OrderListState, "from" | "to">): string | null {
  return state.from !== "" && state.to !== "" && state.from > state.to ? "The start date is after the end date." : null;
}

export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const paymentMethodText = (method: AdminOrderRow["paymentMethod"]): string => (method === "cod" ? "Cash on delivery" : method === "card" ? "Card" : "Not set");

export const itemCountText = (count: number): string => count + (count === 1 ? " item" : " items");

/** "Order ORD-1234 · Rs. 7,250": the line the drawer opens with. */
export function orderTitle(order: Pick<AdminOrderRow, "orderNumber" | "total">): string {
  return "Order " + order.orderNumber + " · " + formatRs(order.total);
}

/** The lines of the totals block, in order; a zero discount is left out. */
export function totalsLines(totals: AdminOrderDetail["totals"]): Array<{ label: string; value: string }> {
  const lines = [{ label: "Subtotal", value: formatRs(totals.subtotal) }];
  if (totals.discount > 0) lines.push({ label: "Discount", value: "- " + formatRs(totals.discount) });
  lines.push({ label: "Delivery", value: formatRs(totals.delivery) }, { label: "Total", value: formatRs(totals.total) });
  return lines;
}
