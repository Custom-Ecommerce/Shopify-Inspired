export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** The code the subscription routes answer with while Stripe subscriptions are off (Sprint 6 EP-14, D-118). */
export const SUBSCRIPTION_STRIPE_OFF = 'SUBSCRIPTION_STRIPE_OFF';

/**
 * Sprint 6 EP-14 (D-118): Stripe subscriptions stay in the code but are OFF until the owner decides otherwise. Subscription payment is manual
 * first (bank, JazzCash, Easypaisa; an admin marks it paid). The switch is the environment variable SUBSCRIPTION_STRIPE_ENABLED: only 'true'
 * or '1' (any case, spaces ignored) turns it on; anything else, or nothing, is off.
 */
export function subscriptionStripeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.SUBSCRIPTION_STRIPE_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}
