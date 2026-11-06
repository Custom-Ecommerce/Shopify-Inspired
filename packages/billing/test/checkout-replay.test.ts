
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

const WEBHOOK_SECRET = 'whsec_test_secret';

type Doc = Record<string, any>;

let handleStripeWebhook: (rawBody: string, signature: string | null) => Promise<{ status: number; body: Doc }>;
let registerBillingPorts: (ports: any) => void;
let client: Stripe;
let state: { claimed: Set<string>; ledger: Doc[]; releases: number };

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

beforeEach(() => {
  state = { claimed: new Set<string>(), ledger: [], releases: 0 };
  registerBillingPorts({
    ledger: {
      create: async (doc: Doc) => {
        // Mirrors the unique index on (orderId, status, refundId) in the commission ledger.
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
    upsertSubscription: async () => {},
    findSaleByPaymentIntent: async () => null,
    findPlanByPriceId: async () => null,
    findSellerStoreForActor: async () => null,
    saveStoreBilling: async () => {},
  });
});

function checkoutEvent(eventId: string, overrides: Doc = {}, metadata: Doc = {}): Doc {
  return {
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        object: 'checkout.session',
        payment_status: 'paid',
        amount_total: 10000,
        payment_intent: 'pi_1',
        metadata: {
          orderRef: 'ORD-1',
          orderId: 'seller-doc-1',
          storeId: 'store-1',
          commissionRate: '4',
          ...metadata,
        },
        ...overrides,
      },
    },
  };
}

function deliver(event: Doc): { raw: string; signature: string } {
  const raw = JSON.stringify(event);
  const signature = client.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET });
  return { raw, signature };
}

test('a duplicate checkout.session.completed delivery leaves exactly one ledger row', async () => {
  const delivery = deliver(checkoutEvent('evt_checkout_1'));
  const first = await handleStripeWebhook(delivery.raw, delivery.signature);
  const replay = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].orderId, 'ORD-1');
  assert.equal(state.ledger[0].status, 'pending');
  assert.equal(state.ledger[0].orderAmount, 10000);
  assert.equal(state.ledger[0].commissionAmount, 400);
});

test('Stripe retrying the same checkout under a new event id still leaves one ledger row', async () => {
  const first = deliver(checkoutEvent('evt_checkout_1'));
  const retry = deliver(checkoutEvent('evt_checkout_2'));
  await handleStripeWebhook(first.raw, first.signature);
  const outcome = await handleStripeWebhook(retry.raw, retry.signature);
  assert.equal(outcome.status, 200);
  assert.equal(state.ledger.length, 1);
});

test('an unpaid session is acknowledged and writes no ledger row', async () => {
  const delivery = deliver(checkoutEvent('evt_checkout_3', { payment_status: 'unpaid' }));
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 200);
  assert.equal(state.ledger.length, 0);
});

test('a session missing commission metadata fails with 500, releases the claim, and writes nothing', async () => {
  const delivery = deliver(checkoutEvent('evt_checkout_4', {}, { commissionRate: undefined }));
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 500);
  assert.equal(state.releases, 1);
  assert.equal(state.claimed.size, 0);
  assert.equal(state.ledger.length, 0);
});
