
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncHeaders } from '@markaz/platform-kit';
import { requireInternalSignature } from '../src/lib/internal-auth';

const KEY = 'k-test';
const SECRET = 'x'.repeat(40);
const URL_UNDER_TEST = 'http://admin.test/api/internal/stripe/checkout-session';

function signedRequest(body: string, keyId: string = KEY, sentBody: string = body): Request {
  const headers = buildSyncHeaders({ keyId, secret: SECRET, rawBody: body });
  return new Request(URL_UNDER_TEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: sentBody,
  });
}

beforeEach(() => {
  process.env.SYNC_KEY_ID_CURRENT = KEY;
  process.env.SYNC_SECRET_CURRENT = SECRET;
  delete process.env.SYNC_KEY_ID_PREVIOUS;
  delete process.env.SYNC_SECRET_PREVIOUS;
});

afterEach(() => {
  delete process.env.SYNC_KEY_ID_CURRENT;
  delete process.env.SYNC_SECRET_CURRENT;
});

test('a correctly signed request is accepted and its raw body is returned', async () => {
  const body = JSON.stringify({ priceId: 'price_1', storeId: '65a000000000000000000001' });
  const result = await requireInternalSignature(signedRequest(body));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.rawBody, body);
});

test('a body changed after signing is rejected with 401', async () => {
  const signed = JSON.stringify({ priceId: 'price_1' });
  const tampered = JSON.stringify({ priceId: 'price_2' });
  const result = await requireInternalSignature(signedRequest(signed, KEY, tampered));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 401);
});

test('an unknown key id is rejected with 401', async () => {
  const result = await requireInternalSignature(signedRequest('{}', 'someone-else'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 401);
});

test('the bridge refuses every call with 503 when no sync keys are configured', async () => {
  delete process.env.SYNC_KEY_ID_CURRENT;
  delete process.env.SYNC_SECRET_CURRENT;
  const result = await requireInternalSignature(signedRequest('{}'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 503);
});
