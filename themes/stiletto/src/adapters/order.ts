import type { StorefrontOrder } from "@markaz/storefront-data";
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
