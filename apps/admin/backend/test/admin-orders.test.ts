import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { verifyInternalSignature } from '@markaz/platform-kit/internal-signature';
import { User, assertCan, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE, AdminHttpError } from '../src/lib/admin-auth';
import { ORDERS_CAPABILITY, orderSteps } from '../src/lib/admin-orders';

// Sprint 6 EP-14 (S6-B4, D-118, D-093): the admin console's side of manual subscription payments. The routes check the operator's session and the
// policy, validate the body, and forward ONE signed call to the seller backend, which owns the compare-and-set, the subscription and the audit
// entry. The operator is the session's, never the body's. The seller backend is stubbed.

const SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const ORDER = '65a0000000000000000a0001';
const UserModel = User as any;
const realFetch = globalThis.fetch;

type Answer = { status: number; body: unknown } | 'down';
let answer: Answer;
let calls: Array<{ url: string; init: RequestInit }>;
let role = 'admin';
let restoreDb: () => void = () => {};
let listGET: (request: Request) => Promise<Response>;
type Ctx = { params: Promise<{ id: string }> };
let detailGET: (request: Request, context: Ctx) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  listGET = (await import('../src/app/api/admin/orders/route')).GET;
  detailGET = (await import('../src/app/api/admin/orders/[id]/route')).GET;
});

beforeEach(() => {
  process.env.SELLER_BACKEND_URL = 'http://seller.test/';
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  answer = { status: 200, body: { docs: [], page: 1, limit: 20, totalDocs: 0, totalPages: 0 } };
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

// Sprint 6 EP-12 (S6-B5, D-093): the admin console's READ-ONLY orders view. The seller backend and the audit are stubbed.


async function admin(path: string, token?: string | null): Promise<Request> {
  const t = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  return new Request('http://admin.test/api/admin/orders' + path, { headers: t ? { authorization: 'Bearer ' + t } : {} });
}
const detail = async (id: string, token?: string | null) => detailGET(await admin('/' + id, token), { params: Promise.resolve({ id }) });

test('policy: an admin reads the safe order fields only, never name, phone, address or email; a seller reads nothing here; nobody writes', () => {
  assert.doesNotThrow(() => assertCan('admin', 'read', 'adminOrdersView', ['orderNumber', 'status', 'total', 'city', 'items']));
  for (const bad of ['phone', 'address', 'customerName', 'customerEmail']) assert.throws(() => assertCan('admin', 'read', 'adminOrdersView', [bad]), bad);
  assert.throws(() => assertCan('seller', 'read', 'adminOrdersView', ['status']));
  for (const op of ['create', 'update', 'delete'] as const) assert.throws(() => assertCan('admin', op, 'adminOrdersView'), op);
});

test('no token, a seller token and an account that is not an admin are refused (401); nothing is forwarded or audited', async () => {
  const audits: unknown[] = [];
  const saved = orderSteps.audit;
  orderSteps.audit = (async (...a: unknown[]) => audits.push(a)) as any;
  try {
    assert.equal((await listGET(await admin('', null))).status, 401);
    assert.equal((await detail(ORDER, null)).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await listGET(await admin('', seller))).status, 401);
    assert.equal((await detail(ORDER, seller)).status, 401);
    role = 'seller';
    assert.equal((await listGET(await admin(''))).status, 401);
    assert.equal(calls.length + audits.length, 0);
  } finally {
    orderSteps.audit = saved;
  }
});

test('the list forwards the validated filters as ONE signed call with the session operator, and answers the seller backend page', async () => {
  const res = await listGET(await admin('?store=65a000000000000000000011&status=pending&from=2026-11-01&to=2026-11-30&q=ORD&page=2&limit=50'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), answer.body);
  const [call] = calls;
  assert.equal(new URL(call!.url).pathname, '/api/internal/orders');
  assert.deepEqual(JSON.parse(String(call!.init.body)), { store: '65a000000000000000000011', status: 'pending', from: '2026-11-01', to: '2026-11-30', q: 'ORD', page: 2, limit: 50 });
  assert.equal(verify(call!, 'POST', ADMIN_ID, String(call!.init.body)), true);
});

test('the list refuses bad filters with 400 naming the field, a limit over 50, and any private filter; nothing is forwarded', async () => {
  for (const [query, field] of [['?status=paid', 'status'], ['?limit=51', 'limit'], ['?from=yesterday', 'from'], ['?store=x', 'store'], ['?phone=0300', 'phone'], ['?email=a@b.c', 'email'], ['?customerName=Ayesha', 'customerName']] as const) {
    const res = await listGET(await admin(query));
    assert.equal(res.status, 400, query);
    assert.equal(((await res.json()) as { field?: string }).field, field, query);
  }
  assert.equal(calls.length, 0);
});

test('every DETAIL read is audited BEFORE the call; if the audit cannot be written the detail is not read (fail closed)', async () => {
  const log: string[] = [];
  const saved = orderSteps.audit;
  orderSteps.audit = (async (action: string, entity: string, id: string, actor: string, details: Record<string, unknown>) => {
    log.push('audit');
    assert.deepEqual([action, entity, id, actor], ['order.detail_viewed', 'order', ORDER, ADMIN_ID]);
    assert.deepEqual(Object.keys(details), ['at'], 'no order content in the audit entry');
  }) as any;
  answer = { status: 200, body: { order: { id: ORDER } } };
  try {
    const res = await detail(ORDER);
    assert.equal(res.status, 200);
    assert.equal(new URL(calls[0]!.url).pathname, '/api/internal/orders/detail');
    assert.equal(String(calls[0]!.init.body), JSON.stringify({ orderId: ORDER }));
    assert.deepEqual(log, ['audit']);
    calls.length = 0;
    orderSteps.audit = (async () => {
      throw new Error('audit down');
    }) as any;
    assert.equal((await detail(ORDER)).status, 503);
    assert.equal(calls.length, 0, 'no audit entry, no detail');
  } finally {
    orderSteps.audit = saved;
  }
});

test('a bad order id is a 404 before anything; the seller backend 404 and an outage come back as they are', async () => {
  assert.equal((await detail('nope')).status, 404);
  assert.equal(calls.length, 0);
  const saved = orderSteps.audit;
  orderSteps.audit = (async () => undefined) as any;
  try {
    answer = { status: 404, body: { errors: [{ message: 'Order not found' }] } };
    assert.equal((await detail(ORDER)).status, 404);
    answer = 'down';
    assert.equal((await detail(ORDER)).status, 503);
    assert.equal((await listGET(await admin(''))).status, 503);
  } finally {
    orderSteps.audit = saved;
  }
});

test('the capability name is ready for S6-B6', () => {
  assert.equal(ORDERS_CAPABILITY, 'orders.read');
});
