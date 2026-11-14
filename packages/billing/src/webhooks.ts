import type Stripe from 'stripe';
import { stripe } from './stripe-client';
import { getBillingPorts } from './ports';
import { computeCommission, recordRefundReversal } from './commission';
import { isDuplicateKeyError } from './util';

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

function objectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

async function onSubscriptionChanged(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = objectId(sub.customer);
  const item = sub.items.data[0];
  const priceId = item && item.price ? item.price.id : null;
  if (!customerId || !priceId) {
    throw new Error('subscription ' + sub.id + ' is missing customer or price');
  }
  await getBillingPorts().upsertSubscription({
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    stripePriceId: priceId,
    status: sub.status,
    storeId: sub.metadata && sub.metadata.storeId ? sub.metadata.storeId : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

async function onChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId = objectId(charge.payment_intent);
  if (!paymentIntentId) {
    throw new Error('charge ' + charge.id + ' has no payment_intent');
  }

  const ports = getBillingPorts();
  const sale = await ports.findSaleByPaymentIntent(paymentIntentId);
  if (!sale) {
    // Throwing makes the webhook return 500 so Stripe retries after the sale row lands.
    throw new Error('no commission sale row for ' + paymentIntentId + '; will retry');
  }

  const refunds = charge.refunds ? charge.refunds.data : [];
  for (const refund of refunds) {
    if (refund.status === 'failed' || refund.status === 'canceled') continue;
    await recordRefundReversal(ports.ledger, {
      store: sale.store,
      orderId: sale.orderId,
      refundId: refund.id,
      sellerOrderDocId: sale.sellerOrderDocId,
      refundAmountMinor: refund.amount,
      commissionRate: sale.commissionRate,
      paymentMethod: sale.paymentMethod,
      stripePaymentIntentId: paymentIntentId,
    });
  }
}

async function onCheckoutCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') return;

  const meta = session.metadata ?? {};
  // A storefront card order (D-082): the seller backend's own webhook handles it, and it has no commission details to record here.
  if (meta.orderId && !meta.orderRef) return;

  const orderRef = meta.orderRef;
  const sellerOrderDocId = meta.orderId;
  const storeId = meta.storeId;
  const rate = Number(meta.commissionRate);
  if (!orderRef || !sellerOrderDocId || !storeId || !Number.isFinite(rate)) {
    throw new Error('checkout session ' + session.id + ' is missing order, store or commission metadata');
  }
  if (typeof session.amount_total !== 'number') {
    throw new Error('checkout session ' + session.id + ' has no amount');
  }

  const commissionAmount = computeCommission(session.amount_total, rate);
  try {
    await getBillingPorts().ledger.create({
      store: storeId,
      orderId: orderRef,
      refundId: null,
      sellerOrderDocId,
      orderAmount: session.amount_total,
      commissionRate: rate,
      commissionAmount,
      status: 'pending',
      paymentMethod: 'card',
      stripePaymentIntentId: objectId(session.payment_intent) ?? '',
      applicationFeeId: '',
    });
  } catch (err) {
    // The ledger's unique key (orderId, status, refundId) makes a repeat write a no-op.
    if (!isDuplicateKeyError(err)) throw err;
  }
}

export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { status: 500, body: { error: 'STRIPE_WEBHOOK_SECRET is not set' } };
  }
  if (!signature) {
    return { status: 400, body: { error: 'missing stripe-signature header' } };
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return { status: 400, body: { error: 'signature verification failed' } };
  }

  const ports = getBillingPorts();
  const claimed = await ports.claimWebhookEvent(event.id, event.type);
  if (!claimed) {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await onSubscriptionChanged(event);
        break;
      case 'checkout.session.completed':
        await onCheckoutCompleted(event);
        break;
      case 'charge.refunded':
        await onChargeRefunded(event);
        break;
      default:
        return { status: 200, body: { received: true, ignored: event.type } };
    }
    return { status: 200, body: { received: true, type: event.type } };
  } catch (err) {
    await ports.releaseWebhookEvent(event.id);
    const message = err instanceof Error ? err.message : 'unknown error';
    return { status: 500, body: { error: message } };
  }
}
