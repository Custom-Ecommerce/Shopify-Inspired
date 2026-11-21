import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { verifyInternalSignature } from '@markaz/platform-kit/internal-signature';
import { User, assertCan, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE, AdminHttpError } from '../src/lib/admin-auth';
import { hideReview, listModerationReviews, unhideReview } from '../src/lib/seller-moderation-client';

// Sprint 5 EP-21.US01.T05 (D-108): the admin console's review moderation. The routes check the operator's session and the policy, then forward ONE
// signed call to the seller backend (D-026), which owns the write, the audit entry and the storefront purge. The signature covers the method, the
// path with its query, the body and the operator; the operator is the session's, never the body's.

const SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const REVIEW = '65a0000000000000000f0001';
const UserModel = User as any;
const realFetch = globalThis.fetch;

type Answer = { status: number; body: unknown } | 'down';
let answer: Answer;
let calls: Array<{ url: string; init: RequestInit }>;
let role = 'admin';
let restoreDb: () => void = () => {};
let listGET: (request: Request) => Promise<Response>;
let actionPOST: (request: Request, context: { params: Promise<{ action: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  listGET = (await import('../src/app/api/admin/reviews/route')).GET;
  actionPOST = (await import('../src/app/api/admin/reviews/[action]/route')).POST;
});

beforeEach(() => {
  process.env.SELLER_BACKEND_URL = 'http://seller.test/';
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  answer = { status: 200, body: { reviewId: REVIEW, status: 'rejected' } };
  calls = [];
  role = 'admin';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (answer === 'down') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  const saved = { connect: (mongoose as any).connect, findById: UserModel.findById };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role, accountStatus: 'active', tokenVersion: 0 }) }) });
  restoreDb = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findById = saved.findById;
  };
});

afterEach(() => {
  restoreDb();
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

const verify = (call: { url: string; init: RequestInit }, method: string, adminId: string | null, body: string): boolean => {
  const url = new URL(call.url);
  const headers = new Headers(call.init.headers);
  return verifyInternalSignature({
    secret: MOD_SECRET,
    method,
    path: url.pathname + url.search,
    body,
    timestamp: headers.get('x-markaz-timestamp'),
    signature: headers.get('x-markaz-signature'),
    adminId,
  });
};

// ------------------------------------------------------------------------------------------------------------------ the client

test('the list is one signed GET to the seller backend, with only the filters it was given in the signed path', async () => {
  await listModerationReviews('admin-1', { status: 'rejected', page: '2', storeId: undefined, limit: '' });
  const [call] = calls;
  assert.ok(call);
  const url = new URL(call.url);
  assert.equal(url.host, 'seller.test');
  assert.equal(url.pathname, '/api/internal/moderation/reviews');
  assert.equal(url.search, '?status=rejected&page=2');
  assert.equal(verify(call, 'GET', 'admin-1', ''), true);
  assert.equal(verify(call, 'GET', 'admin-2', ''), false, 'another operator is not what was signed');
  assert.equal(verify({ ...call, url: call.url.replace('rejected', 'approved') }, 'GET', 'admin-1', ''), false, 'a changed filter is not what was signed');
});

test('hide and unhide send the exact body they signed, to their own paths', async () => {
  await hideReview('admin-1', REVIEW, 'Abusive language');
  await unhideReview('admin-1', REVIEW);
  const [hide, unhide] = calls;
  assert.ok(hide && unhide);
  assert.equal(new URL(hide.url).pathname, '/api/internal/moderation/reviews/hide');
  assert.equal(new URL(unhide.url).pathname, '/api/internal/moderation/reviews/unhide');
  assert.equal(String(hide.init.body), JSON.stringify({ reviewId: REVIEW, reason: 'Abusive language' }));
  assert.equal(String(unhide.init.body), JSON.stringify({ reviewId: REVIEW }));
  assert.equal(verify(hide, 'POST', 'admin-1', String(hide.init.body)), true);
  assert.equal(verify(hide, 'POST', 'admin-1', JSON.stringify({ reviewId: REVIEW, reason: 'Another reason' })), false);
  assert.equal(verify(unhide, 'POST', 'admin-1', String(unhide.init.body)), true);
});

test('the seller backend\'s refusals keep their status and their own words; a signature problem or an outage reads as unavailable, never as a session ending', async () => {
  answer = { status: 404, body: { errors: [{ message: 'Review not found' }] } };
  const missing = await refusal(hideReview('admin-1', REVIEW, 'Abusive language'));
  assert.equal(missing.status, 404);
  assert.equal(missing.message, 'Review not found');
  answer = { status: 409, body: { errors: [{ message: 'This review changed. Reload and try again.' }], code: 'REVIEW_STATUS_CHANGED' } };
  const changed = await refusal(unhideReview('admin-1', REVIEW));
  assert.equal(changed.status, 409);
  answer = { status: 401, body: { errors: [{ message: 'Unauthorized' }] } };
  assert.equal((await refusal(hideReview('admin-1', REVIEW, 'Abusive language'))).status, 503);
  answer = 'down';
  assert.equal((await refusal(listModerationReviews('admin-1', {}))).status, 503);
  delete process.env.MODERATION_API_SECRET;
  assert.equal((await refusal(listModerationReviews('admin-1', {}))).status, 503);
});

// ------------------------------------------------------------------------------------------------------------------- the routes

async function admin(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<Request> {
  const token = init.token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : init.token;
  return new Request('http://admin.test/api/admin/reviews' + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(init.body === undefined ? {} : { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) }),
  });
}

const act = async (action: string, body: unknown, token?: string | null) => actionPOST(await admin('/' + action, { method: 'POST', body, token }), { params: Promise.resolve({ action }) });

test('policy: an admin reads and updates reviews (the hide fields), a seller and the public do not', () => {
  assert.doesNotThrow(() => assertCan('admin', 'read', 'reviews'));
  assert.doesNotThrow(() => assertCan('admin', 'update', 'reviews', ['status', 'hiddenReason', 'hiddenAt', 'hiddenBy']));
  assert.throws(() => assertCan('seller', 'update', 'reviews', ['status']));
  assert.throws(() => assertCan('public', 'read', 'reviews'));
});

test('no token, a seller token and a session whose account is not an admin are refused (401) and nothing is forwarded', async () => {
  assert.equal((await listGET(await admin('', { token: null }))).status, 401);
  assert.equal((await act('hide', { reviewId: REVIEW, reason: 'Abusive language' }, null)).status, 401);
  const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
  assert.equal((await act('hide', { reviewId: REVIEW, reason: 'Abusive language' }, seller)).status, 401);
  role = 'seller';
  assert.equal((await act('hide', { reviewId: REVIEW, reason: 'Abusive language' })).status, 401);
  assert.equal(calls.length, 0);
});

test('GET /api/admin/reviews forwards only the known filters, signed with the session\'s operator, and answers the seller backend\'s list', async () => {
  answer = { status: 200, body: { docs: [], page: 1, limit: 20, totalDocs: 0, totalPages: 0 } };
  const res = await listGET(await admin('?status=rejected&storeId=65a000000000000000000011&page=2&limit=20&evil=1&q=x'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), answer.body);
  const [call] = calls;
  assert.ok(call);
  const url = new URL(call.url);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['limit', 'page', 'status', 'storeId']);
  assert.equal(verify(call, 'GET', ADMIN_ID, ''), true, 'the operator is the session\'s');
});

test('hide: the reason is required (422), the operator is the session\'s (never the body\'s), and the seller backend\'s answer comes back', async () => {
  assert.equal((await act('hide', { reviewId: REVIEW })).status, 422);
  assert.equal((await act('hide', { reviewId: REVIEW, reason: 'no' })).status, 422);
  assert.equal((await act('hide', { reviewId: 'nope', reason: 'Abusive language' })).status, 422);
  assert.equal(calls.length, 0, 'nothing reached the seller backend');
  const res = await act('hide', { reviewId: REVIEW, reason: '  Abusive language  ', adminId: 'someone-else' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reviewId: REVIEW, status: 'rejected' });
  const [call] = calls;
  assert.ok(call);
  assert.equal(String(call.init.body), JSON.stringify({ reviewId: REVIEW, reason: 'Abusive language' }));
  assert.equal(verify(call, 'POST', ADMIN_ID, String(call.init.body)), true);
  assert.equal(verify(call, 'POST', 'someone-else', String(call.init.body)), false);
});

test('unhide needs only the review id; an unknown action is 404; a refusal of the seller backend keeps its status and words', async () => {
  const res = await act('unhide', { reviewId: REVIEW });
  assert.equal(res.status, 200);
  assert.equal(new URL(calls[0]!.url).pathname, '/api/internal/moderation/reviews/unhide');
  assert.equal((await act('delete', { reviewId: REVIEW })).status, 404);
  answer = { status: 404, body: { errors: [{ message: 'Review not found' }] } };
  const missing = await act('unhide', { reviewId: REVIEW });
  assert.equal(missing.status, 404);
  assert.equal(JSON.stringify(await missing.json()).includes('Review not found'), true);
});
