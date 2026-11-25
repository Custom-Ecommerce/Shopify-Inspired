import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { verifyInternalSignature } from '@markaz/platform-kit/internal-signature';
import { User, assertCan, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE, AdminHttpError } from '../src/lib/admin-auth';
import { PAYMENT_CAPABILITIES } from '../src/lib/admin-subscription-payments';
import {
  confirmSubscriptionPayment,
  listSubscriptionPayments,
  rejectSubscriptionPayment,
  voidSubscriptionPayment,
} from '../src/lib/seller-moderation-client';

// Sprint 6 EP-14 (S6-B4, D-118, D-093): the admin console's side of manual subscription payments. The routes check the operator's session and the
// policy, validate the body, and forward ONE signed call to the seller backend, which owns the compare-and-set, the subscription and the audit
// entry. The operator is the session's, never the body's. The seller backend is stubbed.

const SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const PAYMENT = '65a0000000000000000e0001';
const UserModel = User as any;
const realFetch = globalThis.fetch;

type Answer = { status: number; body: unknown } | 'down';
let answer: Answer;
let calls: Array<{ url: string; init: RequestInit }>;
let role = 'admin';
let restoreDb: () => void = () => {};
let listGET: (request: Request) => Promise<Response>;
type Ctx = { params: Promise<{ id: string }> };
let confirmPOST: (request: Request, context: Ctx) => Promise<Response>;
let rejectPOST: (request: Request, context: Ctx) => Promise<Response>;
let voidPOST: (request: Request, context: Ctx) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  listGET = (await import('../src/app/api/admin/subscription-payments/route')).GET;
  confirmPOST = (await import('../src/app/api/admin/subscription-payments/[id]/confirm/route')).POST;
  rejectPOST = (await import('../src/app/api/admin/subscription-payments/[id]/reject/route')).POST;
  voidPOST = (await import('../src/app/api/admin/subscription-payments/[id]/void/route')).POST;
});

beforeEach(() => {
  process.env.SELLER_BACKEND_URL = 'http://seller.test/';
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  answer = { status: 200, body: { payment: { id: PAYMENT, status: 'confirmed' } } };
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
  await listSubscriptionPayments('admin-1', { status: 'claimed', page: 2, limit: undefined });
  const [call] = calls;
  assert.ok(call);
  const url = new URL(call.url);
  assert.equal(url.host, 'seller.test');
  assert.equal(url.pathname, '/api/internal/subscription-payments');
  assert.equal(url.search, '?status=claimed&page=2');
  assert.equal(verify(call, 'GET', 'admin-1', ''), true);
  assert.equal(verify(call, 'GET', 'admin-2', ''), false, 'another operator is not what was signed');
  assert.equal(verify({ ...call, url: call.url.replace('claimed', 'confirmed') }, 'GET', 'admin-1', ''), false, 'a changed filter is not what was signed');
});

test('confirm, reject and void send the exact body they signed, each to its own path', async () => {
  await confirmSubscriptionPayment('admin-1', { paymentId: PAYMENT, amountRs: 2500, reason: 'Slip checked' });
  await rejectSubscriptionPayment('admin-1', { paymentId: PAYMENT, reason: 'Amount does not match' });
  await voidSubscriptionPayment('admin-1', { paymentId: PAYMENT, reason: 'Payment bounced' });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/api/internal/subscription-payments/confirm',
    '/api/internal/subscription-payments/reject',
    '/api/internal/subscription-payments/void',
  ]);
  assert.equal(String(calls[0]!.init.body), JSON.stringify({ paymentId: PAYMENT, amountRs: 2500, reason: 'Slip checked' }));
  for (const call of calls) assert.equal(verify(call, 'POST', 'admin-1', String(call.init.body)), true);
  assert.equal(verify(calls[0]!, 'POST', 'admin-1', JSON.stringify({ paymentId: PAYMENT, amountRs: 1, reason: 'Slip checked' })), false, 'a changed amount is not what was signed');
});

test('the seller backend\'s refusals keep their status, their words and their code; a signature problem or an outage reads as unavailable', async () => {
  answer = { status: 409, body: { errors: [{ message: 'This payment is for Rs. 2,500, not Rs. 900. Reload and check the amount.' }], code: 'PAYMENT_AMOUNT_MISMATCH' } };
  const mismatch = await refusal(confirmSubscriptionPayment('admin-1', { paymentId: PAYMENT, amountRs: 900, reason: 'Slip checked' }));
  assert.deepEqual([mismatch.status, mismatch.code], [409, 'PAYMENT_AMOUNT_MISMATCH']);
  assert.match(mismatch.message, /Rs\. 2,500/);
  answer = { status: 404, body: { errors: [{ message: 'Payment not found' }] } };
  assert.equal((await refusal(rejectSubscriptionPayment('admin-1', { paymentId: PAYMENT, reason: 'Amount does not match' }))).status, 404);
  answer = { status: 401, body: { errors: [{ message: 'Unauthorized' }] } };
  assert.equal((await refusal(voidSubscriptionPayment('admin-1', { paymentId: PAYMENT, reason: 'Payment bounced' }))).status, 503);
  answer = 'down';
  assert.equal((await refusal(listSubscriptionPayments('admin-1', {}))).status, 503);
  delete process.env.MODERATION_API_SECRET;
  assert.equal((await refusal(listSubscriptionPayments('admin-1', {}))).status, 503);
});

// ------------------------------------------------------------------------------------------------------------------- the routes

async function admin(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<Request> {
  const token = init.token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : init.token;
  return new Request('http://admin.test/api/admin/subscription-payments' + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(init.body === undefined ? {} : { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) }),
  });
}

const handlers = { confirm: () => confirmPOST, reject: () => rejectPOST, void: () => voidPOST } as const;
const act = async (action: keyof typeof handlers, body: unknown, token?: string | null, id: string = PAYMENT) =>
  handlers[action]()(await admin('/' + id + '/' + action, { method: 'POST', body, token }), { params: Promise.resolve({ id }) });

test('policy: an admin reads and decides payments (the status fields), a seller reads and creates their own but never decides, and nobody deletes', () => {
  assert.doesNotThrow(() => assertCan('admin', 'read', 'subscriptionPayments'));
  assert.doesNotThrow(() => assertCan('admin', 'update', 'subscriptionPayments', ['status', 'decidedBy', 'decidedAt', 'reason', 'periodStart', 'periodEnd']));
  assert.throws(() => assertCan('admin', 'update', 'subscriptionPayments', ['amountRs']), 'an admin never edits the amount');
  assert.throws(() => assertCan('admin', 'create', 'subscriptionPayments', ['planKey']));
  assert.doesNotThrow(() => assertCan('seller', 'create', 'subscriptionPayments', ['planKey']));
  assert.throws(() => assertCan('seller', 'update', 'subscriptionPayments', ['decidedBy']));
  assert.throws(() => assertCan('seller', 'create', 'subscriptionPayments', ['amountRs']));
  assert.throws(() => assertCan('public', 'read', 'subscriptionPayments'));
  for (const actor of ['admin', 'seller', 'system', 'public'] as const) assert.throws(() => assertCan(actor, 'delete', 'subscriptionPayments'), actor);
});

test('no token, a seller token and a session whose account is not an admin are refused (401) on every route and nothing is forwarded: a seller cannot confirm their own payment', async () => {
  assert.equal((await listGET(await admin('', { token: null }))).status, 401);
  for (const action of ['confirm', 'reject', 'void'] as const) {
    const body = action === 'confirm' ? { amountRs: 2500, reason: 'Slip checked' } : { reason: 'Amount does not match' };
    assert.equal((await act(action, body, null)).status, 401, action + ' without a token');
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await act(action, body, seller)).status, 401, action + ' with a seller token');
    role = 'seller';
    assert.equal((await act(action, body)).status, 401, action + ' for an account that is not an admin');
    role = 'admin';
  }
  assert.equal(calls.length, 0);
});

test('GET forwards only status, page and limit, signed with the session\'s operator, and answers the seller backend\'s list', async () => {
  answer = { status: 200, body: { docs: [], page: 1, limit: 20, totalDocs: 0, totalPages: 0, pendingCount: 0 } };
  const res = await listGET(await admin('?status=claimed&page=2&limit=20'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), answer.body);
  const url = new URL(calls[0]!.url);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['limit', 'page', 'status']);
  assert.equal(verify(calls[0]!, 'GET', ADMIN_ID, ''), true, 'the operator is the session\'s');
});

test('GET: an unknown status or a bad page is 422 and nothing is forwarded', async () => {
  for (const query of ['?status=paid', '?page=0', '?limit=500', '?sort=amount']) assert.equal((await listGET(await admin(query))).status, 422, query);
  assert.equal(calls.length, 0);
});

test('confirm: the amount and the reason are required (400 naming the field), a fractional amount and an extra key are refused, and nothing reaches the seller backend', async () => {
  const bodies: Array<[unknown, string]> = [
    [{ reason: 'Slip checked' }, 'amountRs'],
    [{ amountRs: 2500 }, 'reason'],
    [{ amountRs: 2500.5, reason: 'Slip checked' }, 'amountRs'],
    [{ amountRs: 0, reason: 'Slip checked' }, 'amountRs'],
    [{ amountRs: 2500, reason: 'ok' }, 'reason'],
    [{ amountRs: 2500, reason: 'Slip checked', paymentId: PAYMENT }, 'paymentId'],
    [{ amountRs: 2500, reason: 'Slip checked', status: 'confirmed' }, 'status'],
  ];
  for (const [body, field] of bodies) {
    const res = await act('confirm', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(((await res.json()) as { field?: string }).field, field, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('confirm forwards the payment id from the PATH, the amount and the reason, signed with the session\'s operator (never the body\'s)', async () => {
  const res = await act('confirm', { amountRs: 2500, reason: '  Slip checked ' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), answer.body);
  const [call] = calls;
  assert.ok(call);
  assert.equal(new URL(call.url).pathname, '/api/internal/subscription-payments/confirm');
  assert.equal(String(call.init.body), JSON.stringify({ paymentId: PAYMENT, amountRs: 2500, reason: 'Slip checked' }));
  assert.equal(verify(call, 'POST', ADMIN_ID, String(call.init.body)), true);
  assert.equal(verify(call, 'POST', 'someone-else', String(call.init.body)), false);
});

test('reject and void: a reason of 5 or more characters is required; they forward the reason and the path\'s id only', async () => {
  for (const action of ['reject', 'void'] as const) {
    calls.length = 0;
    assert.equal((await act(action, {})).status, 400, action);
    assert.equal((await act(action, { reason: 'four' })).status, 400, action);
    assert.equal((await act(action, { reason: 'Amount does not match', amountRs: 1 })).status, 400, action + ' takes no amount');
    assert.equal(calls.length, 0, action);
    const res = await act(action, { reason: ' Amount does not match ' });
    assert.equal(res.status, 200, action);
    assert.equal(new URL(calls[0]!.url).pathname, '/api/internal/subscription-payments/' + action);
    assert.equal(String(calls[0]!.init.body), JSON.stringify({ paymentId: PAYMENT, reason: 'Amount does not match' }));
    assert.equal(verify(calls[0]!, 'POST', ADMIN_ID, String(calls[0]!.init.body)), true);
  }
});

test('a payment id that is not an ObjectId is a 404 before anything is read or forwarded', async () => {
  assert.equal((await act('confirm', { amountRs: 2500, reason: 'Slip checked' }, undefined, 'not-an-id')).status, 404);
  assert.equal((await act('reject', { reason: 'Amount does not match' }, undefined, '123')).status, 404);
  assert.equal(calls.length, 0);
});

test('a double confirm: the seller backend\'s 409 comes back to the operator with its words and its code', async () => {
  answer = { status: 409, body: { errors: [{ message: 'Someone else already decided this payment. Reload the list.' }], code: 'PAYMENT_ALREADY_DECIDED' } };
  const res = await act('confirm', { amountRs: 2500, reason: 'Slip checked' });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string; code?: string };
  assert.match(body.error, /Someone else already decided/);
  assert.equal(body.code, 'PAYMENT_ALREADY_DECIDED');
});

test('a confirm of a rejected payment: the seller backend\'s refusal reaches the operator; an unreachable seller backend is a 503, nothing is faked', async () => {
  answer = { status: 409, body: { errors: [{ message: 'Only a payment the seller says they paid can be confirmed. This one is rejected.' }], code: 'PAYMENT_NOT_CLAIMED' } };
  const refused = await act('confirm', { amountRs: 2500, reason: 'Slip checked' });
  assert.equal(refused.status, 409);
  answer = 'down';
  assert.equal((await act('confirm', { amountRs: 2500, reason: 'Slip checked' })).status, 503);
  assert.equal((await listGET(await admin(''))).status, 503);
});

test('the capability names are ready for the admin levels of S6-B6: one per action', () => {
  assert.deepEqual(PAYMENT_CAPABILITIES, {
    read: 'subscription_payments.read',
    confirm: 'subscription_payments.confirm',
    reject: 'subscription_payments.reject',
    void: 'subscription_payments.void',
  });
});
