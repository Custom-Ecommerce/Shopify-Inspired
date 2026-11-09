const KEY = "stiletto:last-order";

export interface LastOrder {
  orderId: string;
  total: number;
  whatsapp: string;
  /** Left out by an order remembered before card payment existed. */
  paymentMethod?: "cod" | "card";
}

/** What the order page says about payment. Null when it does not know the method, so it says nothing untrue. */
export function paymentLine(
  method: LastOrder["paymentMethod"],
  paymentStatus: string | null,
  orderStatus: string | null,
): string | null {
  if (method === "cod") return "Cash on Delivery (Pending)";
  if (method !== "card") return null;
  if (paymentStatus === "paid") return "Paid";
  return orderStatus === "cancelled" ? "Payment not completed" : "Awaiting payment";
}

/** Keeps the figures the order page shows (the order page is reached by id only). Best effort: storage may be unavailable. */
export function rememberLastOrder(order: LastOrder): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* storage unavailable: the order page falls back to its defaults */
  }
}

export function readLastOrder(orderId: string): LastOrder | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastOrder;
    return parsed && parsed.orderId === orderId ? parsed : null;
  } catch {
    return null;
  }
}
