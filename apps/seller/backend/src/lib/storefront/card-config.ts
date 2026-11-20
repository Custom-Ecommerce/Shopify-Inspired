/*
 * What card payment needs from the environment (A-015). Nothing here reads a database, so the store answer can ask it.
 * Values are only ever tested or passed to Stripe. Never log them.
 */

/** Stripe refuses an expiry under 30 minutes after the session is made, so a minute of margin covers the time to make it. */
export const CARD_SESSION_LIFETIME_MS = 31 * 60 * 1000;

const present = (value: string | undefined): boolean => typeof value === 'string' && value.trim() !== '';

function storefrontRoot(): URL | null {
  try {
    return new URL(process.env.STOREFRONT_URL ?? '');
  } catch {
    return null;
  }
}

export const orderWebhookSecret = (): string => process.env.STRIPE_ORDER_WEBHOOK_SECRET ?? '';

/**
 * Sprint 5 EP-11.US04 (D-107): the platform switch for card checkout. Shoppers pay by cash on delivery only until a gateway
 * epic; CARD_CHECKOUT_ENABLED must be exactly "true" (or "1") to turn card on, whatever Stripe keys exist. Unset or anything
 * else is off. Stripe stays configured for seller billing (EP-14), which this switch does not touch.
 */
export function cardCheckoutSwitchedOn(): boolean {
  const raw = (process.env.CARD_CHECKOUT_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * True when the Stripe side of a card order is usable: the key to start a payment, the webhook secret to learn it was paid, and
 * the storefront's address to send the shopper back to. NOT the platform switch. The webhook and the session expiry use this,
 * so an order that was already placed by card still completes or is closed after the switch goes off.
 */
export function stripeCardConfigured(): boolean {
  return present(process.env.STRIPE_SECRET_KEY) && present(orderWebhookSecret()) && storefrontRoot() !== null;
}

/**
 * True when a NEW card order may be offered and taken: the platform switch is on AND Stripe is configured. This is what the
 * storefront answer, the checkout and the settings read; while the switch is off nothing offers card.
 */
export function cardPaymentsAvailable(): boolean {
  return cardCheckoutSwitchedOn() && stripeCardConfigured();
}

/**
 * Where Stripe sends the shopper afterwards: the store's own order page, on <slug>.<root> from STOREFRONT_URL, the address
 * the seller's preview links use. Built here from configuration and the stored slug, never from anything the browser sent.
 */
export function checkoutReturnUrl(slug: string, orderId: string): string {
  const root = storefrontRoot();
  if (root === null) throw new Error('STOREFRONT_URL is not usable');
  return root.protocol + '//' + slug + '.' + root.host.replace(/^www\./, '') + '/orders/' + encodeURIComponent(orderId);
}
