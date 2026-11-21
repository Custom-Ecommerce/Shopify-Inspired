import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

// Sprint 6 EP-14 (D-118, CO-62): Stripe subscriptions are OFF (SUBSCRIPTION_STRIPE_ENABLED). A subscription checkout session used to fall
// into the order path and answer 500 forever; now it is acknowledged and ignored. No database: the ports are in memory.

const WEBHOOK_SECRET = 'whsec_test_secret';

type Doc = Record<string, any>;

let handleStripeWebhook: (rawBody: string, signature: string | null) => Promise<{ status: number; body: Doc }>;
let registerBillingPorts: (ports: any) => void;
let subscriptionStripeEnabled: (env?: Record<string, string | undefined>) => boolean;
let client: Stripe;
let state: { claimed: Set<string>; ledger: Doc[]; releases: number; subscriptions: Doc[] };

before(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  client = new Stripe('sk_test_dummy');
  handleStripeWebhook = (await import('../src/webhooks')).handleStripeWebhook as typeof handleStripeWebhook;
  registerBillingPorts = (await import('../src/ports')).registerBillingPorts as typeof registerBillingPorts;
  subscriptionStripeEnabled = (await import('../src/util')).subscriptionStripeEnabled as typeof subscriptionStripeEnabled;
});

beforeEach(() => {
  delete process.env.SUBSCRIPTION_STRIPE_ENABLED;
  state = { claimed: new Set<string>(), ledger: [], releases: 0, subscriptions: [] };
  registerBillingPorts({
    ledger: {
      create: async (doc: Doc) => {
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
    findSaleByPaymentIntent: async () => null,
    findPlanByPriceId: async () => null,
    findSellerStoreForActor: async () => null,
    saveStoreBilling: async () => {},
  });
});

afterEach(() => {
  delete process.env.SUBSCRIPTION_STRIPE_ENABLED;
});

function deliver(event: Doc): { raw: string; signature: string } {
  const raw = JSON.stringify(event);
  return { raw, signature: client.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET }) };
}

const subscriptionCheckout = (id: string): Doc => ({
  id,
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_sub_1',
      object: 'checkout.session',
      mode: 'subscription',
      payment_status: 'paid',
      amount_total: 250000,
      subscription: 'sub_1',
      metadata: { storeId: 'store-1', planTier: 'pro' },
    },
  },
});

const orderCheckout = (id: string): Doc => ({
  id,
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_order_1',
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 10000,
      payment_intent: 'pi_1',
      metadata: { orderRef: 'ORD-1', orderId: 'seller-doc-1', storeId: 'store-1', commissionRate: '4' },
    },
  },
});

const subscriptionEvent = (id: string, type: string): Doc => ({
  id,
  object: 'event',
  type,
  data: {
    object: {
      id: 'sub_1',
      object: 'subscription',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { storeId: 'store-1' },
      items: { object: 'list', data: [{ id: 'si_1', price: { id: 'price_1' } }] },
    },
  },
});

// ------------------------------------------------------------------------------------------------------------------------ the flag

test('the flag is on only for true or 1, in any case and with spaces; everything else is off', () => {
  for (const on of ['true', 'TRUE', ' True ', '1']) assert.equal(subscriptionStripeEnabled({ SUBSCRIPTION_STRIPE_ENABLED: on }), true, on);
  for (const off of [undefined, '', '0', 'false', 'yes', 'on', 'enabled', 'truee']) assert.equal(subscriptionStripeEnabled({ SUBSCRIPTION_STRIPE_ENABLED: off }), false, String(off));
  assert.equal(subscriptionStripeEnabled(), false, 'off by default');
});

// --------------------------------------------------------------------------------------------------------- CO-62, flag off

test('CO-62: a subscription checkout session with the flag off is acknowledged and ignored, not a 500', async () => {
  const delivery = deliver(subscriptionCheckout('evt_sub_1'));
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.received, true);
  assert.equal(outcome.body.ignored, 'subscription_stripe_off');
  assert.equal(state.ledger.length, 0, 'no ledger row for a subscription');
  assert.equal(state.releases, 0, 'the claim is kept: Stripe is not asked to retry');
});

test('a replay of the same subscription checkout is a plain duplicate, still 200', async () => {
  const delivery = deliver(subscriptionCheckout('evt_sub_2'));
  assert.equal((await handleStripeWebhook(delivery.raw, delivery.signature)).status, 200);
  const replay = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(state.ledger.length, 0);
});

test('with the flag off, customer.subscription.created and .updated are acknowledged and write no subscription', async () => {
  for (const [id, type] of [['evt_s1', 'customer.subscription.created'], ['evt_s2', 'customer.subscription.updated']] as const) {
    const delivery = deliver(subscriptionEvent(id, type));
    const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
    assert.equal(outcome.status, 200, type);
    assert.equal(outcome.body.ignored, 'subscription_stripe_off', type);
  }
  assert.equal(state.subscriptions.length, 0);
});

test('with the flag off, a storefront card order checkout is handled exactly as before', async () => {
  const delivery = deliver(orderCheckout('evt_order_1'));
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 200);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0]!.orderId, 'ORD-1');
  assert.equal(state.ledger[0]!.commissionAmount, 400);
});

test('a session of the order path that is missing its metadata is still a 500 and releases its claim (only subscriptions changed)', async () => {
  const event = orderCheckout('evt_order_2');
  delete event.data.object.metadata.commissionRate;
  const delivery = deliver(event);
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 500);
  assert.equal(state.releases, 1);
  assert.equal(state.ledger.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------- flag on

test('with the flag on, a subscription checkout is acknowledged as a subscription and still writes no ledger row', async () => {
  process.env.SUBSCRIPTION_STRIPE_ENABLED = 'true';
  const delivery = deliver(subscriptionCheckout('evt_sub_3'));
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.subscription, true);
  assert.equal(outcome.body.ignored, undefined);
  assert.equal(state.ledger.length, 0);
});

test('with the flag on, the subscription events are stored through the port', async () => {
  process.env.SUBSCRIPTION_STRIPE_ENABLED = '1';
  const delivery = deliver(subscriptionEvent('evt_s3', 'customer.subscription.created'));
  const outcome = await handleStripeWebhook(delivery.raw, delivery.signature);
  assert.equal(outcome.status, 200);
  assert.equal(state.subscriptions.length, 1);
  assert.deepEqual([state.subscriptions[0]!.stripeSubscriptionId, state.subscriptions[0]!.stripePriceId, state.subscriptions[0]!.storeId], ['sub_1', 'price_1', 'store-1']);
});
