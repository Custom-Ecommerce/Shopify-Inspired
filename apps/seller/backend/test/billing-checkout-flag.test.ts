import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as dbNs from '@markaz/db-schemas';
import { unwrapCjs } from '@/lib/cjs';
import { signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setSessionUserLoader } from '@/lib/session-user';
import { subscriptionStripeEnabled } from '../src/app/api/billing/_shared';

// Sprint 6 EP-14 (D-118, CO-73): POST /api/billing/checkout is 404 SUBSCRIPTION_STRIPE_OFF while Stripe subscriptions are off, and once on it
// asks the billing port for the seller's own store (a seller can own several). The admin bridge and the port are stubbed; no network.

const AUTH_SECRET = 'x'.repeat(40);
const SELLER = '65a000000000000000000001';
const STORE = '65a0000000000000000000a1';
const ports = unwrapCjs(dbNs).billingPortsImpl as any;
const realFetch = globalThis.fetch;

let token = '';
let checkoutPOST: (r: Request) => Promise<Response>;
let calls: Array<{ actorId: string; storeId: string | undefined }>;
let bridged: Array<{ url: string; body: any }>;
let savedFind: unknown;

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  token = await signSession({ sub: SELLER, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  checkoutPOST = (await import('../src/app/api/billing/checkout/route')).POST;
});

beforeEach(() => {
  delete process.env.SUBSCRIPTION_STRIPE_ENABLED;
  process.env.SELLER_APP_URL = 'https://seller.test';
  process.env.ADMIN_BACKEND_API_URL = 'https://admin.test';
  process.env.SYNC_KEY_ID_CURRENT = 'k1';
  process.env.SYNC_SECRET_CURRENT = 's'.repeat(40);
  calls = [];
  bridged = [];
  savedFind = ports.findSellerStoreForActor;
  ports.findSellerStoreForActor = async (actorId: string, storeId?: string) => {
    calls.push({ actorId, storeId });
    return { storeId: storeId ?? STORE, ownerEmail: 'a@example.com', countryCode: 'PK', stripeCustomerId: null, stripeAccountId: null };
  };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    bridged.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ sessionId: 'cs_1', url: 'https://stripe.test/pay' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  setSessionUserLoader(async () => ({ role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerified: true, emailVerifiedAt: new Date() }) as any);
});

afterEach(() => {
  ports.findSellerStoreForActor = savedFind;
  globalThis.fetch = realFetch;
  setSessionUserLoader(null);
  delete process.env.SUBSCRIPTION_STRIPE_ENABLED;
});

const post = (body: unknown, bearer: string | null = token) =>
  checkoutPOST(
    new Request('http://seller.test/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
      body: JSON.stringify(body),
    }),
  );

test('the flag is read from the environment: only true or 1 is on', () => {
  for (const [value, expected] of [[undefined, false], ['', false], ['false', false], ['0', false], ['true', true], ['TRUE', true], [' 1 ', true]] as const) {
    if (value === undefined) delete process.env.SUBSCRIPTION_STRIPE_ENABLED;
    else process.env.SUBSCRIPTION_STRIPE_ENABLED = value;
    assert.equal(subscriptionStripeEnabled(), expected, String(value));
  }
});

test('with the flag off a signed-in seller gets 404 SUBSCRIPTION_STRIPE_OFF, and nothing is looked up or sent to the admin bridge', async () => {
  const res = await post({ priceId: 'price_1' });
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code: string }).code, 'SUBSCRIPTION_STRIPE_OFF');
  assert.equal(calls.length + bridged.length, 0);
});

test('with the flag off, no session is still 401 (the flag does not hide that the caller must sign in)', async () => {
  assert.equal((await post({ priceId: 'price_1' }, null)).status, 401);
});

test('with the flag on and no storeId, the port is asked for the seller\'s own store, not User.store', async () => {
  process.env.SUBSCRIPTION_STRIPE_ENABLED = 'true';
  const res = await post({ priceId: 'price_1' });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ actorId: SELLER, storeId: undefined }]);
  assert.equal(bridged[0]!.url, 'https://admin.test/api/internal/stripe/checkout-session');
  assert.equal(bridged[0]!.body.storeId, STORE);
});

test('with the flag on, a storeId is passed to the port (so a seller with several stores picks one), and a malformed one is 422', async () => {
  process.env.SUBSCRIPTION_STRIPE_ENABLED = '1';
  const other = '65a0000000000000000000a2';
  assert.equal((await post({ priceId: 'price_1', storeId: other })).status, 200);
  assert.deepEqual(calls, [{ actorId: SELLER, storeId: other }]);
  assert.equal(bridged[0]!.body.storeId, other);
  for (const bad of ['nope', 5, null]) assert.equal((await post({ priceId: 'price_1', storeId: bad })).status, 422, String(bad));
  assert.equal(calls.length, 1);
});

test('with the flag on, a seller whose store is not found (or not theirs) is 404 and nothing goes to the bridge', async () => {
  process.env.SUBSCRIPTION_STRIPE_ENABLED = 'true';
  ports.findSellerStoreForActor = async () => null;
  const res = await post({ priceId: 'price_1', storeId: '65a0000000000000000000a9' });
  assert.equal(res.status, 404);
  assert.equal(bridged.length, 0);
  assert.equal((await post({})).status, 422, 'a price is still required');
});
