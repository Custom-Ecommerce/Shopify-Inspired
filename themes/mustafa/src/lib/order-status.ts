import type { OrderStatus, PaymentMethod } from "@markaz/storefront-data";
import type { BadgeTone } from "../components/ui/badge";

export interface OrderStatusCopy {
  label: string;
  description: string;
  tone: BadgeTone;
}

/** The steps a shopper sees, in order. Cancelled and returned orders leave the track and show their own copy. */
export const ORDER_STATUS_STEPS: readonly { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "Received" },
  { status: "confirmed", label: "Confirmed" },
  { status: "processing", label: "Preparing" },
  { status: "dispatched", label: "Dispatched" },
  { status: "delivered", label: "Delivered" },
];

const COPY: Record<OrderStatus, OrderStatusCopy> = {
  pending: {
    label: "Received",
    description: "We have received your order and are confirming the details.",
    tone: "neutral",
  },
  confirmed: {
    label: "Confirmed",
    description: "Your order is confirmed and will be prepared soon.",
    tone: "primary",
  },
  processing: {
    label: "Being prepared",
    description: "Your items are being packed for dispatch.",
    tone: "primary",
  },
  dispatched: {
    label: "On its way",
    description: "Your order has left the store and is on its way to you.",
    tone: "warning",
  },
  delivered: {
    label: "Delivered",
    description: "Your order has been delivered. Thank you for shopping with us.",
    tone: "success",
  },
  cancelled: {
    label: "Cancelled",
    description: "This order was cancelled. If you did not expect this, contact the store.",
    tone: "danger",
  },
  returned: {
    label: "Returned",
    description: "This order was returned to the store.",
    tone: "neutral",
  },
};

export function orderStatusCopy(status: OrderStatus): OrderStatusCopy {
  return COPY[status];
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cod: "Cash on delivery",
  card: "Card",
};
