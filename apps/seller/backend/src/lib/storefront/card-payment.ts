import { unwrapCjs } from '@/lib/cjs';
import { PAYMENT_NOT_COMPLETED_REASON, PAYMENT_SYSTEM_ACTOR, cancelOrder } from '@/lib/order-cancel';
import { Order, Store } from '@/lib/services';
import { CARD_SESSION_LIFETIME_MS, checkoutReturnUrl } from '@/lib/storefront/card-config';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import type { OrderRow } from '@/lib/storefront/order-dto';

type BillingModule = typeof import('@markaz/billing');
export type StripeClient = ReturnType<BillingModule['getStripe']>;

/** Inside the 20 seconds the BFF waits for an order (D-077), so a slow Stripe gets an answer rather than a timeout. */
const STRIPE_REQUEST = { timeout: 10_000, maxNetworkRetries: 1 } as const;

/** How long a first request may still be working on its session. A replay inside this leaves the order alone. */
const FIRST_REQUEST_GRACE_MS = 2 * 60 * 1000;

/** Loaded on first use: @markaz/billing creates its client at import, which throws without a key. Callers check availability first. */
export async function stripeClient(): Promise<StripeClient> {
  const billing = unwrapCjs(await import('@markaz/billing')) as BillingModule;
  return billing.getStripe();
}

const paymentNotStarted = (): StorefrontHttpError =>
  new StorefrontHttpError(502, 'PAYMENT_NOT_STARTED', 'We could not start the card payment, so this order was cancelled. Please try again or choose cash on delivery.');

const stillStarting = (): StorefrontHttpError =>
  new StorefrontHttpError(503, 'STOREFRONT_UNAVAILABLE', 'The card payment could not be started yet. Please try again in a moment.');

const errorLabel = (err: unknown): string => {
  const e = err as { code?: unknown; type?: unknown };
  return String(e?.code ?? e?.type ?? 'unknown');
};

async function storeSlug(storeId: string): Promise<string> {
  const row = (await Store.findById(storeId).select('slug').lean()) as unknown as { slug?: unknown } | null;
  if (typeof row?.slug !== 'string' || row.slug === '') throw new Error('the store has no slug');
  return row.slug;
}

/**
 * Makes the order's one Stripe session and records it on the order. The Stripe idempotency key is derived from the order, and
 * the expiry comes from the order too so the request is identical each time: a retry gets the same session back, never a second.
 */
async function createSession(stripe: StripeClient, storeId: string, order: OrderRow): Promise<string | null> {
  const orderDocId = String(order._id);
  const returnUrl = checkoutReturnUrl(await storeSlug(storeId), order.orderId);
  const expiresAt = order.stripeSessionExpiresAt ? new Date(order.stripeSessionExpiresAt) : new Date(Date.now() + CARD_SESSION_LIFETIME_MS);

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'pkr', unit_amount: Math.round(Number(order.total ?? 0) * 100), product_data: { name: 'Order ' + order.orderId } },
        },
      ],
      metadata: { orderId: orderDocId, storeId },
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      success_url: returnUrl,
      cancel_url: returnUrl,
    },
    { ...STRIPE_REQUEST, idempotencyKey: 'order-checkout-' + orderDocId },
  );

  // A session the order does not name could be paid and never be matched, so a failure here counts as a failure to start.
  await Order.updateOne({ _id: orderDocId, store: storeId }, { $set: { stripeSessionId: session.id, stripeSessionExpiresAt: expiresAt } });
  return session.url;
}

/**
 * The address the shopper pays at, for an order that placeOrder has just created or replayed. Null when there is nothing left
 * to pay. A replay gets the same session.
 *
 * When a session cannot be made the order is cancelled through the usual path, so its stock and discount use come back, and
 * the shopper is told. The one exception is a replay soon after the order was made: the first request may still be working.
 */
export async function cardCheckoutUrl(storeId: string, order: OrderRow, replayed: boolean): Promise<string | null> {
  // A retry of an order whose payment could not start, with the same key. It is finished: the shopper starts again.
  if (order.status === 'cancelled') throw paymentNotStarted();
  if (order.paymentStatus === 'paid') return null;

  const stripe = await stripeClient();

  if (order.stripeSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId, undefined, STRIPE_REQUEST);
      return session.url;
    } catch (err) {
      console.error('[seller-backend] could not read a Stripe session', { orderId: order.orderId, error: errorLabel(err) });
      throw stillStarting();
    }
  }

  try {
    return await createSession(stripe, storeId, order);
  } catch (err) {
    console.error('[seller-backend] could not create a Stripe session', { orderId: order.orderId, error: errorLabel(err) });
    const madeAt = order.createdAt ? new Date(order.createdAt).getTime() : 0;
    if (replayed && Date.now() - madeAt < FIRST_REQUEST_GRACE_MS) throw stillStarting();
    await cancelOrder({
      orderId: String(order._id),
      storeId,
      reason: PAYMENT_NOT_COMPLETED_REASON,
      note: 'The card payment could not be started.',
      actor: PAYMENT_SYSTEM_ACTOR,
      onlyIfUnpaid: true,
    }).catch((cancelErr: unknown) => console.error('[seller-backend] could not cancel an order after a Stripe failure', { orderId: order.orderId, error: errorLabel(cancelErr) }));
    throw paymentNotStarted();
  }
}
