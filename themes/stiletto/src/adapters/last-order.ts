const KEY = "stiletto:last-order:v2";
/** What earlier versions kept, which held a phone number. Removed on sight. */
const OLD_KEY = "stiletto:last-order";

/** All this tab keeps about its order: no name, phone or address. sessionStorage goes when the tab closes. */
export interface LastOrder {
  orderId: string;
  /** Lets this tab read the order back. Null when the server has no secret configured. */
  accessToken: string | null;
}

const storage = (): Storage | null => {
  try {
    window.sessionStorage.removeItem(OLD_KEY);
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function rememberLastOrder(order: LastOrder): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ orderId: order.orderId, accessToken: order.accessToken }));
  } catch {
    /* not kept: the order page then asks for the order number and phone */
  }
}

export function readLastOrder(orderId: string): LastOrder | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastOrder>;
    if (parsed.orderId !== orderId) return null;
    return { orderId, accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null };
  } catch {
    return null;
  }
}

interface PaymentFacts {
  paymentMethod: string;
  paymentStatus: string;
  status: string;
}

/** How the order is being paid, and where that stands, in the words the order page uses. */
export function paymentSummary(order: PaymentFacts): { method: string; state: string } {
  if (order.paymentMethod === "card") {
    if (order.paymentStatus === "paid") return { method: "Card", state: "Paid" };
    return { method: "Card", state: order.status === "cancelled" ? "Payment not completed" : "Awaiting payment" };
  }
  if (order.paymentStatus === "collected") return { method: "Cash on Delivery", state: "Paid" };
  return { method: "Cash on Delivery", state: order.status === "cancelled" ? "Not charged" : "Pay when it arrives" };
}

/** The one sentence on what happens now. */
export function whatHappensNext(order: PaymentFacts): string {
  if (order.status === "cancelled") return "This order was cancelled. Nothing more will happen, and you can place a new order at any time.";
  if (order.paymentMethod === "card" && order.paymentStatus !== "paid") return "We are waiting to hear that your payment went through. This page updates by itself, and an unpaid order is cancelled when the payment window closes.";
  return "We will confirm your order and contact you on WhatsApp, then send it out. You can follow it from the tracking page.";
}
