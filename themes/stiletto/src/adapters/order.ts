import type { StorefrontOrder, StorefrontOrderTracking } from "@markaz/storefront-data";
import { formatCurrency } from "../shared/lib/services";

/** The order shape Stiletto's tracking page was written against. */
export interface TrackedOrder {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  totalPrice: string;
  tracking: { company: string; number: string; url: string } | null;
  items: Array<{ title: string; quantity: number; price: string; image: string | null }>;
}

const money = (n: number) => formatCurrency(String(Math.round(n)), "PKR");

export function toTrackedOrder(order: StorefrontOrder): TrackedOrder {
  const dispatched = order.status === "dispatched" || order.status === "delivered";
  return {
    id: order.orderId,
    name: order.orderId,
    createdAt: new Date(order.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }),
    financialStatus: order.paymentMethod === "cod" ? (order.status === "delivered" ? "Paid on delivery" : "Cash on delivery") : "Card",
    fulfillmentStatus: dispatched ? "FULFILLED" : "UNFULFILLED",
    totalPrice: money(order.total),
    tracking: null,
    items: order.items.map((i) => ({ title: i.title, quantity: i.qty, price: money(i.lineTotal), image: null })),
  };
}

// EP-02 OB-4 (D-069): customer tracking. The step line the tracking page shows.

export interface TrackingStep {
  key: "pending" | "confirmed" | "processing" | "dispatched" | "delivered";
  label: string;
  /** Formatted date the order reached this step, or null when it has not (or the date is unknown). */
  date: string | null;
  done: boolean;
  current: boolean;
}

const STEPS: ReadonlyArray<{ key: TrackingStep["key"]; label: string }> = [
  { key: "pending", label: "Order placed" },
  { key: "confirmed", label: "Confirmed" },
  { key: "processing", label: "Processing" },
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered", label: "Delivered" },
];

const formatDate = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : null;

/**
 * pending -> confirmed -> processing -> dispatched -> delivered, each with its date. Steps up to the current status are
 * done even when an older order has no date for them. A cancelled or returned order has no step line (the page shows the
 * status only).
 */
export function toTrackingSteps(tracking: StorefrontOrderTracking): TrackingStep[] {
  const reached = STEPS.findIndex((step) => step.key === tracking.status);
  if (reached === -1) return [];
  return STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    date: formatDate(tracking.dates[step.key]),
    done: index <= reached,
    current: index === reached,
  }));
}

export const trackingPlacedOn = (tracking: StorefrontOrderTracking): string | null => formatDate(tracking.createdAt);
