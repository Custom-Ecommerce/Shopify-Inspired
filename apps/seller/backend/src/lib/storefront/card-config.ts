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
 * True when a card order could be taken and completed: the Stripe key to start a payment, the webhook secret to learn it was
 * paid, and the storefront's address to send the shopper back to.
 */
export function cardPaymentsAvailable(): boolean {
  return present(process.env.STRIPE_SECRET_KEY) && present(orderWebhookSecret()) && storefrontRoot() !== null;
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
