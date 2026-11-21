import { storefrontCheckoutCustomerSchema } from "@markaz/contracts/checkout";

/*
 * Sprint 5 EP-28.US01.T03 (D-107): the abandoned cart consent. A cart is kept for the seller to follow up only after the shopper typed a valid
 * phone number AND was shown this line next to the phone field. Both themes show this exact line (the Stiletto checkout section and the Mustafa
 * checkout page), and useCheckout is the one place that makes the one debounced call.
 */

/** The words shown next to the phone field. Mirrors ABANDONED_CART_CONSENT_LINE in @markaz/contracts. */
export const ABANDONED_CART_CONSENT_LINE = "We may message you about this cart";

/** The checkout waits this long after the last change of the phone, the email or the cart before it keeps the cart. */
export const ABANDONED_CART_DEBOUNCE_MS = 1500;

export interface AbandonedCartPlan {
  /** What changing means: the same signature is never sent twice. */
  signature: string;
  input: { phone: string; email: string | null; lines: Array<{ productId: string; variantId: string; qty: number }> };
}

/**
 * Decides whether the checkout should keep the cart for the seller, and with what: only when the phone is a valid Pakistani mobile number
 * (the checkout's own phone rule, output +923xxxxxxxxx) and the cart is not empty. The email is optional and only kept when it is valid. Only
 * product ids, variant ids and quantities are sent: never a price or a total. Pure, so it is tested without React.
 */
export function planAbandonedCart(
  phone: string | undefined,
  email: string | undefined,
  lines: ReadonlyArray<{ productId: string; variantId: string; qty: number }>,
): AbandonedCartPlan | null {
  if (lines.length === 0) return null;
  const validPhone = storefrontCheckoutCustomerSchema.shape.phone.safeParse(phone ?? "");
  if (!validPhone.success) return null;
  const validEmail = storefrontCheckoutCustomerSchema.shape.email.safeParse(email ?? "");
  const emailValue = validEmail.success ? validEmail.data : null;
  const cartLines = lines.map((line) => ({ productId: line.productId, variantId: line.variantId, qty: line.qty }));
  return {
    signature: JSON.stringify({ phone: validPhone.data, email: emailValue, lines: cartLines }),
    input: { phone: validPhone.data, email: emailValue, lines: cartLines },
  };
}
