
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

const WEBHOOK_SECRET = 'whsec_test_secret';
const ORDER_AMOUNT = 10000;

type Doc = Record<string, any>;

let handleStripeWebhook: (rawBody: string, signature: string | null) => Promise<{ status: number; body: Doc }>;
let registerBillingPorts: (ports: any) => void;
let client: Stripe;
let state: {
  claimed: Set<string>;
  ledger: Doc[];
  subscriptions: Doc[];
  releases: number;
  sales: Map<string, Doc>;
};

before(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  client = new Stripe('sk_test_dummy');
  const webhooks = await import('../src/webhooks');
  const ports = await import('../src/ports');
  handleStripeWebhook = webhooks.handleStripeWebhook as typeof handleStripeWebhook;
  registerBillingPorts = ports.registerBillingPorts as typeof registerBillingPorts;
});

function duplicateKeyError(): Error {
  return Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
}

function freshPorts(): void {
  state = {
    claimed: new Set<string>(),
    ledger: [],
    subscriptions: [],
    releases: 0,
    sales: new Map<string, Doc>([
      [
        'pi_1',
        {
          store: 'store-1',
          orderId: 'ORD-1',
          sellerOrderDocId: 'seller-doc-1',
          commissionRate: 4,
          paymentMethod: 'card',
          stripePaymentIntentId: 'pi_1',
        },
      ],
    ]),
  };
  registerBillingPorts({
    ledger: {
      create: async (doc: Doc) => {
        const duplicate = state.ledger.some(
          (row) => row.orderId === doc.orderId && row.status === doc.status && row.refundId === doc.refundId,
        );
        if (duplicate) throw duplicateKeyError();
        state.ledger.push(doc);
        return doc;
      },
    },
    claimWebhookEvent: async (eventId: string) => {
      if (state.claimed.has(eventId)) return false;
      state.claimed.add(eventId);
      return true;
    },
    releaseWebhookEvent: async (eventId: string) => {
      state.releases += 1;
      state.claimed.delete(eventId);
    },
    upsertSubscription: async (input: Doc) => {
      state.subscriptions.push(input);
    },
    findSaleByPaymentIntent: async (paymentIntentId: string) => state.sales.get(paymentIntentId) ?? null,
    findPlanByPriceId: async () => null,
    findSellerStoreForActor: async () => null,
    saveStoreBilling: async () => {},
  });
}

beforeEach(() => {
  freshPorts();
});

function refundEvent(eventId: string, refundId: string, paymentIntent = 'pi_1'): Doc {
  return {
    id: eventId,
    object: 'event',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_1',
        object: 'charge',
        payment_intent: paymentIntent,
        refunds: {
          object: 'list',
          data: [{ id: refundId, object: 'refund', amount: ORDER_AMOUNT, status: 'succeeded' }],
        },
      },
    },
  };
}

function subscriptionEvent(eventId: string, status: string): Doc {
  return {
    id: eventId,
    object: 'event',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_1',
        object: 'subscription',
        customer: 'cus_1',
        status,
        cancel_at_period_end: false,
        metadata: { storeId: 'store-1' },
        items: { data: [{ price: { id: 'price_1' } }] },
      },
    },
  };
}

function deliver(event: Doc, secret: string = WEBHOOK_SECRET): { raw: string; signature: string } {
  const raw = JSON.stringify(event);
  const signature = client.webhooks.generateTestHeaderString({ payload: raw, secret });
  return { raw, signature };
}

test('a refund delivery writes one negative reversal row and returns 200', async () => {
  const delivery = deliver(refundEvent('evt_1', 're_1'));
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 200);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].orderAmount, -ORDER_AMOUNT);
  assert.equal(state.ledger[0].refundId, 're_1');
});

test('Stripe redelivering the same event is acknowledged as a duplicate and writes nothing new', async () => {
  const delivery = deliver(refundEvent('evt_1', 're_1'));
  await handleStripeWebhook(delivery.raw, delivery.signature);
  const replay = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(state.ledger.length, 1);
});

test('the same refund under a new event id is recorded once (unique index on orderId, status, refundId)', async () => {
  const first = deliver(refundEvent('evt_1', 're_1'));
  const second = deliver(refundEvent('evt_2', 're_1'));
  await handleStripeWebhook(first.raw, first.signature);
  const outcome = await handleStripeWebhook(second.raw, second.signature);
  assert.equal(outcome.status, 200);
  assert.equal(state.ledger.length, 1);
});

test('a delivery with a bad signature is refused with 400 and claims nothing', async () => {
  const delivery = deliver(refundEvent('evt_1', 're_1'), 'whsec_wrong');
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 400);
  assert.equal(state.claimed.size, 0);
  assert.equal(state.ledger.length, 0);
});

test('a refund that lands before its sale fails with 500, releases the claim, and succeeds on retry', async () => {
  const sales = state.sales;
  state.sales = new Map();
  const first = deliver(refundEvent('evt_1', 're_1'));
  const failed = await handleStripeWebhook(first.raw, first.signature);
  assert.equal(failed.status, 500);
  assert.equal(state.releases, 1);
  assert.equal(state.claimed.size, 0);

  state.sales = sales;
  const retry = deliver(refundEvent('evt_1', 're_1'));
  const succeeded = await handleStripeWebhook(retry.raw, retry.signature);
  assert.equal(succeeded.status, 200);
  assert.equal(state.ledger.length, 1);
});

test('a subscription update is upserted once, and its replay is a duplicate', async () => {
  const delivery = deliver(subscriptionEvent('evt_sub_1', 'active'));
  const first = await handleStripeWebhook(delivery.raw, delivery.signature);
  const replay = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(first.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(state.subscriptions.length, 1);
  assert.equal(state.subscriptions[0].stripeSubscriptionId, 'sub_1');
  assert.equal(state.subscriptions[0].status, 'active');
});
