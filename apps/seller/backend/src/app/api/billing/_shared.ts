import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';

export type CallerResult =
  | { ok: true; actorId: string }
  | { ok: false; response: Response };

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sprint 6 EP-14 (D-118): Stripe subscriptions are OFF unless SUBSCRIPTION_STRIPE_ENABLED is 'true' or '1'. Subscription payment is manual
 * first (bank, JazzCash, Easypaisa; an admin marks it paid).
 */
export function subscriptionStripeEnabled(): boolean {
  const raw = (process.env.SUBSCRIPTION_STRIPE_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/** The answer of every Stripe subscription route while the flag is off. */
export function subscriptionStripeOff(): Response {
  return jsonResponse({ error: 'Subscription payments by card are not available yet.', code: 'SUBSCRIPTION_STRIPE_OFF' }, 404);
}

export function requireEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

export async function requireBillingCaller(request: Request): Promise<CallerResult> {
  try {
    // Hum local authenticate use kar rahe hain jo B6 mein scaffold kiya tha
    const ctx = await authenticate(request as NextRequest);
    return { ok: true, actorId: ctx.userId };
  } catch (err: any) {
    return { ok: false, response: jsonResponse({ error: 'unauthorized' }, 401) };
  }
}