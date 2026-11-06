import Stripe from 'stripe';

let cachedClient: Stripe | undefined;

export function getStripe(): Stripe {
  if (cachedClient) {
    return cachedClient;
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  cachedClient = new Stripe(key);
  return cachedClient;
}

export const stripe = getStripe();
