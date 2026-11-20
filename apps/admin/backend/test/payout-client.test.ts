import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyInternalSignature } from '@markaz/platform-kit/internal-signature';
import { AdminHttpError } from '../src/lib/admin-auth';
import {
  createPayout,
  finishPayout,
  listPayoutBalances,
  listPayoutHistory,
  readCommissionReport,
  readPayoutDetails,
  voidPayout,
} from '../src/lib/seller-moderation-client';

// Sprint 4 EP-05.US03, US06: the signed calls from the admin backend to the seller backend. fetch is stubbed.

const SECRET = 'm'.repeat(40);
const STORE = '65a000000000000000000011';
const PAYOUT = '65a000000000000000000021';
const realFetch = globalThis.fetch;

type Answer = { status: number; body: unknown } | 'down';
let answer: Answer;
let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  process.env.SELLER_BACKEND_URL = 'http://seller.test/';
  process.env.MODERATION_API_SECRET = SECRET;
  answer = { status: 200, body: { ok: true } };
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
  delete process.env.MODERATION_API_SECRET;
});

function signedBy(call: { url: string; init: RequestInit }, method: 'GET' | 'POST', adminId: string): boolean {
  const url = new URL(call.url);
  const headers = new Headers(call.init.headers);
  return verifyInternalSignature({
    secret: SECRET,
    method,
    path: url.pathname + url.search,
    body: call.init.body === undefined ? '' : String(call.init.body),
    timestamp: headers.get('x-markaz-timestamp'),
    signature: headers.get('x-markaz-signature'),
    adminId: headers.get('x-admin-id') === adminId ? adminId : null,
  });
}

async function refusal(run: Promise<unknown>): Promise<AdminHttpError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof AdminHttpError);
    return err;
  }
  throw new Error('expected a refusal');
}

test('the two reads sign the path with its query, so a filter cannot be swapped on the way', async () => {
  await listPayoutBalances('admin-1', { page: 2, limit: 20, q: 'zara' });
  await listPayoutHistory('admin-1', { page: 1, limit: 20, storeId: STORE, status: 'pending_settle' });
  await readCommissionReport('admin-1', { storeId: STORE, period: 'custom', from: '2026-11-01', to: '2026-11-30' });
  const [balances, history, report] = calls;
  assert.equal(new URL(balances!.url).pathname, '/api/internal/payouts/balances');
  assert.equal(new URL(balances!.url).search, '?page=2&limit=20&q=zara');
  assert.equal(new URL(history!.url).pathname, '/api/internal/payouts');
  assert.equal(new URL(history!.url).searchParams.get('status'), 'pending_settle');
  assert.equal(new URL(report!.url).pathname, '/api/internal/commission/report');
  assert.equal(new URL(report!.url).searchParams.get('to'), '2026-11-30');
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(signedBy(call, 'GET', 'admin-1'), true);
    const swapped = { ...call, url: call.url.replace(/limit=20|storeId=[0-9a-f]{24}|period=custom/, 'x=1') };
    if (swapped.url !== call.url) assert.equal(signedBy(swapped, 'GET', 'admin-1'), false);
  }
});

test('an empty filter is left out of the query', async () => {
  await listPayoutBalances('admin-1', { page: 1, limit: 20, q: '' });
  assert.equal(new URL(calls[0]!.url).searchParams.has('q'), false);
  await listPayoutHistory('admin-1', {});
  assert.equal(new URL(calls[1]!.url).search, '');
});

test('each action sends exactly the body it signed, to its own path', async () => {
  const create = { storeId: STORE, expectedBalance: 2110, method: 'jazzcash' as const, reference: 'JC-778812', note: null };
  await createPayout('admin-1', create);
  await voidPayout('admin-1', { payoutId: PAYOUT, reason: 'Sent to the wrong account' });
  await finishPayout('admin-1', { payoutId: PAYOUT });
  await readPayoutDetails('admin-1', { storeId: STORE });
  const expected: Array<[string, unknown]> = [
    ['/api/internal/payouts', create],
    ['/api/internal/payouts/void', { payoutId: PAYOUT, reason: 'Sent to the wrong account' }],
    ['/api/internal/payouts/finish', { payoutId: PAYOUT }],
    ['/api/internal/payouts/details', { storeId: STORE }],
  ];
  assert.equal(calls.length, expected.length);
  calls.forEach((call, index) => {
    assert.equal(call.init.method, 'POST');
    assert.equal(new URL(call.url).pathname, expected[index]![0]);
    assert.deepEqual(JSON.parse(String(call.init.body)), expected[index]![1]);
    assert.equal(signedBy(call, 'POST', 'admin-1'), true);
    assert.equal(signedBy(call, 'POST', 'admin-2'), false, 'the operator is part of the signature');
  });
});

test('a refusal keeps its status, the seller backend\'s words and its code', async () => {
  answer = {
    status: 409,
    body: { errors: [{ message: 'The balance changed while you were paying. Reload and try again.' }], code: 'PAYOUT_BALANCE_CHANGED' },
  };
  const stale = await refusal(createPayout('admin-1', { storeId: STORE, expectedBalance: 5, method: 'bank', reference: 'R', note: null }));
  assert.deepEqual([stale.status, stale.code], [409, 'PAYOUT_BALANCE_CHANGED']);
  assert.match(stale.message, /Reload/);

  answer = { status: 403, body: { errors: [{ message: 'The seller has not verified their email address yet, so no payout can be made.' }], code: 'EMAIL_NOT_VERIFIED' } };
  const unverified = await refusal(createPayout('admin-1', { storeId: STORE, expectedBalance: 5, method: 'bank', reference: 'R', note: null }));
  assert.deepEqual([unverified.status, unverified.code], [403, 'EMAIL_NOT_VERIFIED']);

  answer = { status: 404, body: { errors: [{ message: 'Payout not found' }] } };
  const missing = await refusal(voidPayout('admin-1', { payoutId: PAYOUT, reason: 'abc' }));
  assert.deepEqual([missing.status, missing.code], [404, undefined]);
});

test('a refused signature or an outage is a 503 named for the feature, never the operator\'s own session ending', async () => {
  answer = { status: 401, body: { errors: [{ message: 'Unauthorized' }] } };
  const unsigned = await refusal(readPayoutDetails('admin-1', { storeId: STORE }));
  assert.deepEqual([unsigned.status, unsigned.message], [503, 'Payouts is unavailable']);
  answer = 'down';
  assert.equal((await refusal(listPayoutBalances('admin-1', {}))).status, 503);
  answer = { status: 500, body: {} };
  assert.equal((await refusal(finishPayout('admin-1', { payoutId: PAYOUT }))).status, 502);
  answer = { status: 401, body: {} };
  assert.equal((await refusal(readCommissionReport('admin-1', { storeId: STORE, period: '30' }))).message, 'Commission report is unavailable');
});

test('without an address or a secret nothing is sent', async () => {
  delete process.env.MODERATION_API_SECRET;
  assert.equal((await refusal(readPayoutDetails('admin-1', { storeId: STORE }))).status, 503);
  assert.equal(calls.length, 0);
});
