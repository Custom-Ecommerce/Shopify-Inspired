import type { OrderPayload } from "./types";
import { formatPKR } from "./currency";

// NOTE: this package is UI-agnostic AND app-config-agnostic — it used to
// reach into the storefront's `store.config.ts` directly for the business
// WhatsApp number. That's exactly the kind of upward dependency Phase 2 is
// removing, so the number is now a parameter supplied by the caller (the
// storefront shell, which already reads it from storeConfig/env).
export function buildWhatsappOrderLink(order: OrderPayload, businessWhatsappNumber: string): string {
  const itemLines = order.items.map(
    (item) => `${item.productTitle} × ${item.quantity} — ${formatPKR(item.unitPrice * item.quantity)}`
  );

  const lines = [
    `*New COD Order* — ${order.orderId}`,
    ``,
    `*Items:*`,
    ...itemLines,
    ``,
    `*Subtotal:* ${formatPKR(order.subtotal)}`,
    `*Delivery:* ${order.deliveryCharges === 0 ? "Free" : formatPKR(order.deliveryCharges)}`,
    `*Total:* ${formatPKR(order.total)}`,
    ``,
    `*Customer:* ${order.customerName}`,
    `*Phone:* ${order.phone}`,
    order.secondaryPhone ? `*Alt. Phone:* ${order.secondaryPhone}` : null,
    `*City:* ${order.city}`,
    `*Address:* ${order.address}`,
    order.notes ? `*Notes:* ${order.notes}` : null,
  ].filter((line): line is string => line !== null);

  const message = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${businessWhatsappNumber}?text=${message}`;
}

/** Direct product-enquiry link, used by the PDP "Chat with us" CTA. */
export function buildWhatsappProductEnquiryLink(
  productTitle: string,
  productId: string,
  businessWhatsappNumber: string
): string {
  const message = encodeURIComponent(
    `Hi! I'd like to ask about "${productTitle}" (ID: ${productId}). Is it available?`
  );
  return `https://wa.me/${businessWhatsappNumber}?text=${message}`;
}
