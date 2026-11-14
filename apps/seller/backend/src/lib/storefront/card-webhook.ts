import { connectSellerDb } from '@/lib/mongo';
import { notifyOrderPlaced } from '@/lib/notifications';
import { PAYMENT_NOT_COMPLETED_REASON, PAYMENT_SYSTEM_ACTOR, cancelOrder } from '@/lib/order-cancel';
import { assertCan, Order, ORDER_ACTIONS, writeAuditLog } from '@/lib/services';
import { cardPaymentsAvailable, orderWebhookSecret } from '@/lib/storefront/card-config';
import { stripeClient, type StripeClient } from '@/lib/storefront/card-payment';

const HEX_ID = /^[0-9a-fA-F]{24}$/;

type StripeEvent = ReturnType<StripeClient['webhooks']['constructEvent']>;

/** The part of a Checkout Session this file reads. */
interface SessionFields {
  id: string;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string | null;
}

interface CardOrderRow {
  _id: unknown;
  orderId?: string;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  stripeSessionId?: string | null;
  total?: number;
}

export interface WebhookAnswer {
  status: number;
  body: Record<string, unknown>;
}

const ignored = (reason: string, context: Record<string, unknown>): void => {
  console.warn('[seller-backend] stripe order event ignored: ' + reason, context);
};

/** The order this session was made for, or null with the reason logged. Sessions of other kinds share this Stripe account. */
async function orderOfSession(session: SessionFields, eventId: string): Promise<{ row: CardOrderRow; storeId: string } | null> {
  const orderId = session.metadata?.orderId;
  const storeId = session.metadata?.storeId;
  if (!orderId || !storeId || !HEX_ID.test(orderId) || !HEX_ID.test(storeId)) {
    ignored('no order on the session', { eventId, sessionId: session.id });
    return null;
  }
  const row = (await Order.findOne({ _id: orderId, store: storeId }).lean()) as unknown as CardOrderRow | null;
  if (!row || row.stripeSessionId !== session.id || row.paymentMethod !== 'card') {
    ignored('unknown session', { eventId, sessionId: session.id, orderId });
    return null;
  }
  return { row, storeId };
}

async function auditPayment(row: CardOrderRow, storeId: string, session: SessionFields): Promise<void> {
  try {
    await writeAuditLog('order.payment', 'order', String(row._id), PAYMENT_SYSTEM_ACTOR.auditActor, {
      storeId,
      orderId: row.orderId ?? null,
      amount: row.total ?? 0,
      sessionId: session.id,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the card payment audit entry', { orderId: String(row._id) }, err);
  }
}

/** Unpaid to paid, once. The compare-and-set is what makes a repeated event harmless. No commission ledger here (EP-05). */
async function onCompleted(session: SessionFields, eventId: string): Promise<void> {
  const found = await orderOfSession(session, eventId);
  if (!found) return;
  const { row, storeId } = found;
  const context = { eventId, sessionId: session.id, orderId: row.orderId };

  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return ignored('session is not paid', context);

  const total = Number(row.total ?? 0);
  if (session.amount_total !== Math.round(total * 100)) return ignored('amount does not match the order', context);
  if ((session.currency ?? '').toLowerCase() !== 'pkr') return ignored('currency does not match the order', context);

  if (row.paymentStatus === 'paid') return ignored('already paid', context);
  if (row.status === 'cancelled') {
    // The shopper's money was taken for an order that no longer exists. Someone has to refund it.
    console.error('[seller-backend] a cancelled order was paid and needs a refund', context);
    return;
  }

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    { _id: String(row._id), store: storeId, stripeSessionId: session.id, paymentStatus: 'unpaid', status: { $ne: 'cancelled' } },
    {
      $set: { paymentStatus: 'paid', paidAt: now },
      $push: {
        statusHistory: {
          from: row.status,
          to: row.status,
          by: PAYMENT_SYSTEM_ACTOR.userObjectId,
          at: now,
          note: 'Card payment received: Rs. ' + total.toLocaleString('en-US'),
          kind: 'payment',
        },
      },
    },
    { new: true, runValidators: true },
  ).lean();

  if (!updated) return ignored('lost to another change', context);
  await auditPayment(row, storeId, session);
  // EP-07.US01.T03: a card order is announced once it is paid, by the winner of the unpaid-to-paid compare-and-set.
  notifyOrderPlaced(storeId, updated);
}

/** A session that will never be paid. The order goes through the usual cancel, and only if it is still unpaid (A-016). */
async function onNotCompleted(session: SessionFields, eventId: string): Promise<void> {
  const found = await orderOfSession(session, eventId);
  if (!found) return;
  const { row, storeId } = found;
  const context = { eventId, sessionId: session.id, orderId: row.orderId };

  if (row.paymentStatus !== 'unpaid') return ignored('order is not unpaid', context);

  const result = await cancelOrder({
    orderId: String(row._id),
    storeId,
    reason: PAYMENT_NOT_COMPLETED_REASON,
    actor: PAYMENT_SYSTEM_ACTOR,
    onlyIfUnpaid: true,
  });
  if (result.outcome !== 'cancelled') ignored('order could not be cancelled: ' + result.outcome, context);
}

/**
 * The Stripe webhook for storefront card orders (D-082). An answer of 200 means leave it: a repeat, an unknown session and a
 * mismatch are all logged and left. A 5xx asks Stripe to send it again, which is safe because every write is a compare-and-set.
 *
 * checkout.session.async_payment_failed is the failure event. payment_intent.payment_failed is deliberately not handled: it
 * fires on every declined card while the session is still open and the shopper can try another.
 */
export async function handleOrderPaymentWebhook(rawBody: string, signature: string | null): Promise<WebhookAnswer> {
  if (!cardPaymentsAvailable()) return { status: 503, body: { error: 'Card payments are not configured' } };
  if (!signature) return { status: 400, body: { error: 'missing stripe-signature header' } };

  const stripe = await stripeClient();
  let event: StripeEvent;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, orderWebhookSecret());
  } catch {
    return { status: 400, body: { error: 'signature verification failed' } };
  }

  const handled = ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_failed'];
  if (!handled.includes(event.type)) return { status: 200, body: { received: true, ignored: event.type } };

  try {
    await connectSellerDb();
    assertCan('system', ORDER_ACTIONS.payment.operation, ORDER_ACTIONS.payment.collection, ['paymentStatus', 'paidAt']);
    assertCan('system', ORDER_ACTIONS.cancel.operation, ORDER_ACTIONS.cancel.collection, ['reason']);
    const session = event.data.object as unknown as SessionFields;
    if (event.type === 'checkout.session.completed') await onCompleted(session, event.id);
    else await onNotCompleted(session, event.id);
    return { status: 200, body: { received: true } };
  } catch (err) {
    console.error('[seller-backend] stripe order event failed', { eventId: event.id, message: err instanceof Error ? err.message : 'unknown' });
    return { status: 500, body: { error: 'could not process the event' } };
  }
}
