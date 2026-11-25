import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncHeaders } from '@markaz/platform-kit';

// Sprint 6 EP-14 (D-118): the admin checkout-session bridge answers 404 SUBSCRIPTION_STRIPE_OFF while SUBSCRIPTION_STRIPE_ENABLED is off.
// The signature is checked first (a 401 stays a 401). No database and no Stripe key are needed to get the answer.

const KEY = 'k-test';
const SECRET = 'x'.repeat(40);
const URL_UNDER_TEST = 'http://admin.test/api/internal/stripe/checkout-session';

let POST: (request: Request) => Promise<Response>;

before(async () => {
  POST = (await import('../src/app/api/internal/stripe/checkout-session/route')).POST;
});

beforeEach(() => {
  process.env.SYNC_KEY_ID_CURRENT = KEY;
  process.env.SYNC_SECRET_CURRENT = SECRET;
  delete process.env.SUBSCRIPTION_STRIPE_ENABLED;
});

afterEach(() => {
  delete process.env.SYNC_KEY_ID_CURRENT;
  delete process.env.SYNC_SECRET_CURRENT;
  delete process.env.SUBSCRIPTION_STRIPE_ENABLED;
});

const body = JSON.stringify({ priceId: 'price_1', storeId: '65a000000000000000000001', ownerEmail: 'a@example.com', successUrl: 'https://s.test/ok', cancelUrl: 'https://s.test/no' });

function signed(raw: string, secret = SECRET): Request {
  return new Request(URL_UNDER_TEST, { method: 'POST', headers: { 'Content-Type': 'application/json', ...buildSyncHeaders({ keyId: KEY, secret, rawBody: raw }) }, body: raw });
}

test('with the flag off (unset) a signed call is 404 with the code SUBSCRIPTION_STRIPE_OFF', async () => {
  const res = await POST(signed(body));
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code: string }).code, 'SUBSCRIPTION_STRIPE_OFF');
});

test('anything but true or 1 is off', async () => {
  for (const value of ['', '0', 'false', 'no', 'enabled']) {
    process.env.SUBSCRIPTION_STRIPE_ENABLED = value;
    const res = await POST(signed(body));
    assert.equal(res.status, 404, value);
    assert.equal(((await res.json()) as { code: string }).code, 'SUBSCRIPTION_STRIPE_OFF', value);
  }
});

test('the signature is checked first: an unsigned or wrongly signed call is 401, not a hint that the flag is off', async () => {
  assert.equal((await POST(new Request(URL_UNDER_TEST, { method: 'POST', body }))).status, 401);
  assert.equal((await POST(signed(body, 'y'.repeat(40)))).status, 401);
});

test('with the flag on, the call gets past the flag: a signed call with a bad body is 422, bad JSON is 400', async () => {
  process.env.SUBSCRIPTION_STRIPE_ENABLED = 'true';
  assert.equal((await POST(signed(JSON.stringify({ priceId: 1 })))).status, 422);
  assert.equal((await POST(signed('not json'))).status, 400);
});
