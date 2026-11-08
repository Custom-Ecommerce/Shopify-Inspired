import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyInternalSignature } from '@markaz/platform-kit/internal-signature';
import { AdminHttpError } from '../src/lib/admin-auth';
import { listModerationProducts, takedownProduct } from '../src/lib/seller-moderation-client';

const SECRET = 'm'.repeat(40);
const PRODUCT = '65a0000000000000000000b1';
const realFetch = globalThis.fetch;

type Answer = { status: number; body: unknown } | 'down';
let answer: Answer;
let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  process.env.SELLER_BACKEND_URL = 'http://seller.test/';
  process.env.MODERATION_API_SECRET = SECRET;
  answer = { status: 200, body: { productId: PRODUCT } };
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (answer === 'down') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SELLER_BACKEND_URL;
  delete process.env.SELLER_BACKEND_API_URL;
  delete process.env.MODERATION_API_SECRET;
});

async function refusal(run: Promise<unknown>): Promise<AdminHttpError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof AdminHttpError);
    return err;
  }
  throw new Error('expected a refusal');
}

test('a request the seller backend can verify: method, path with query, body and operator are all signed', async () => {
  await listModerationProducts('admin-1', { status: 'live', page: '2', q: undefined });
  const [call] = calls;
  assert.ok(call);
  const url = new URL(call.url);
  const headers = new Headers(call.init.headers);
  const check = (path: string, adminId: string | null) =>
    verifyInternalSignature({
      secret: SECRET,
      method: 'GET',
      path,
      body: '',
      timestamp: headers.get('x-markaz-timestamp'),
      signature: headers.get('x-markaz-signature'),
      adminId,
    });
  assert.equal(url.host, 'seller.test');
  assert.equal(check(url.pathname + url.search, headers.get('x-admin-id')), true);
  assert.equal(check(url.pathname, headers.get('x-admin-id')), false);
  assert.equal(check(url.pathname + url.search, 'admin-2'), false);
});

test('an action sends the exact body it signed', async () => {
  await takedownProduct('admin-1', PRODUCT, 'Counterfeit goods');
  const [call] = calls;
  assert.ok(call);
  const headers = new Headers(call.init.headers);
  assert.equal(
    verifyInternalSignature({
      secret: SECRET,
      method: 'POST',
      path: '/api/internal/moderation/takedown',
      body: String(call.init.body),
      timestamp: headers.get('x-markaz-timestamp'),
      signature: headers.get('x-markaz-signature'),
      adminId: headers.get('x-admin-id'),
    }),
    true,
  );
  assert.deepEqual(JSON.parse(String(call.init.body)), { productId: PRODUCT, reason: 'Counterfeit goods' });
  assert.ok(call.init.signal instanceof AbortSignal);
});

test('a missing address or a missing or short secret is a 503, and nothing is sent', async () => {
  delete process.env.SELLER_BACKEND_URL;
  assert.equal((await refusal(listModerationProducts('a', {}))).status, 503);
  process.env.SELLER_BACKEND_URL = 'http://seller.test';
  process.env.MODERATION_API_SECRET = 'short';
  assert.equal((await refusal(listModerationProducts('a', {}))).status, 503);
  delete process.env.MODERATION_API_SECRET;
  assert.equal((await refusal(listModerationProducts('a', {}))).status, 503);
  assert.equal(calls.length, 0);
});

test('the address already in this app\'s environment works as well', async () => {
  delete process.env.SELLER_BACKEND_URL;
  process.env.SELLER_BACKEND_API_URL = 'http://other.test';
  await listModerationProducts('a', {});
  assert.equal(new URL(calls[0]?.url ?? '').host, 'other.test');
});

test('a refused signature is a 503, never a 401, so the operator is not signed out', async () => {
  answer = { status: 401, body: { errors: [{ message: 'Unauthorized' }] } };
  assert.equal((await refusal(listModerationProducts('a', {}))).status, 503);
});

test('a refusal keeps its status and the seller backend\'s message; an outage is a 503', async () => {
  answer = { status: 409, body: { errors: [{ message: 'Move this product to trash first.', code: 'PRODUCT_NOT_IN_TRASH' }] } };
  const conflict = await refusal(takedownProduct('a', PRODUCT, 'Reason'));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.message, 'Move this product to trash first.');

  answer = 'down';
  assert.equal((await refusal(listModerationProducts('a', {}))).status, 503);
  answer = { status: 500, body: {} };
  assert.equal((await refusal(listModerationProducts('a', {}))).status, 502);
});
