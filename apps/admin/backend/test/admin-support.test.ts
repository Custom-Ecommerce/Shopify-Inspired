import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { verifyInternalSignature } from '@markaz/platform-kit/internal-signature';
import { User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '../src/lib/admin-auth';
import { supportSteps } from '../src/lib/admin-support';

// Sprint 7 (S7-B4, D-093): the admin console's support inbox. Each route checks the operator's session and CAPABILITY, validates the body, forwards ONE signed
// call to the seller backend (which owns the compare-and-set and the seller email), and writes the ADMIN audit entry for a reply and a status change.
// The seller backend and the audit are stubbed.

const SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const TICKET = '65a000000000000000000401';
const MESSAGE = '65a000000000000000000501';
const UserModel = User as any;
const realFetch = globalThis.fetch;

type Answer = { status: number; body: unknown } | 'down';
let answer: Answer;
let calls: Array<{ url: string; init: RequestInit }>;
let audits: any[][];
let level: string | undefined;
let restoreDb: () => void = () => {};
let restoreAudit: () => void = () => {};

type Ctx = { params: Promise<{ id: string }> };
type Handler = (request: Request, context?: Ctx) => Promise<Response>;
const routes: Record<string, Handler> = {};

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  routes.listTickets = (await import('../src/app/api/admin/tickets/route')).GET as Handler;
  routes.readTicket = (await import('../src/app/api/admin/tickets/[id]/route')).GET as Handler;
  routes.reply = (await import('../src/app/api/admin/tickets/[id]/reply/route')).POST as Handler;
  routes.status = (await import('../src/app/api/admin/tickets/[id]/status/route')).POST as Handler;
  routes.listContact = (await import('../src/app/api/admin/contact-messages/route')).GET as Handler;
  routes.readContact = (await import('../src/app/api/admin/contact-messages/[id]/route')).GET as Handler;
});

beforeEach(() => {
  process.env.SELLER_BACKEND_URL = 'http://seller.test/';
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  answer = { status: 200, body: { docs: [], page: 1, limit: 20, totalDocs: 0, totalPages: 1 } };
  calls = [];
  audits = [];
  level = 'customer_support';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (answer === 'down') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  const saved = { connect: (mongoose as any).connect, findById: UserModel.findById, audit: supportSteps.audit };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin', accountStatus: 'active', tokenVersion: 0, ...(level === undefined ? {} : { adminLevel: level }) }) }) });
  supportSteps.audit = (async (...args: any[]) => audits.push(args)) as any;
  restoreDb = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findById = saved.findById;
  };
  restoreAudit = () => {
    supportSteps.audit = saved.audit;
  };
});

afterEach(() => {
  restoreDb();
  restoreAudit();
  globalThis.fetch = realFetch;
  delete process.env.SELLER_BACKEND_URL;
  delete process.env.SELLER_BACKEND_API_URL;
  delete process.env.MODERATION_API_SECRET;
});

const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
async function request(method: string, path: string, body?: unknown, token?: string | null): Promise<Request> {
  const t = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  const headers: Record<string, string> = {};
  if (t) headers.authorization = 'Bearer ' + t;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request('http://admin.test/api/admin' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const verify = (call: { url: string; init: RequestInit }, body: string): boolean => {
  const url = new URL(call.url);
  const headers = new Headers(call.init.headers);
  return verifyInternalSignature({
    secret: MOD_SECRET,
    method: 'POST',
    path: url.pathname + url.search,
    body,
    timestamp: headers.get('x-markaz-timestamp'),
    signature: headers.get('x-markaz-signature'),
    adminId: ADMIN_ID,
  });
};

/** Every route with a request that is valid for it, so the capability matrix runs the same list for each level. */
async function everyRoute(): Promise<Array<{ name: string; capability: string; run: () => Promise<Response> }>> {
  return [
    { name: 'list tickets', capability: 'tickets.read', run: async () => routes.listTickets!(await request('GET', '/tickets')) },
    { name: 'read ticket', capability: 'tickets.read', run: async () => routes.readTicket!(await request('GET', '/tickets/' + TICKET), ctx(TICKET)) },
    { name: 'reply', capability: 'tickets.reply', run: async () => routes.reply!(await request('POST', '/tickets/' + TICKET + '/reply', { revision: 0, text: 'We paid it.' }), ctx(TICKET)) },
    { name: 'status', capability: 'tickets.reply', run: async () => routes.status!(await request('POST', '/tickets/' + TICKET + '/status', { revision: 0, status: 'closed' }), ctx(TICKET)) },
    { name: 'list contact', capability: 'contact.read', run: async () => routes.listContact!(await request('GET', '/contact-messages')) },
    { name: 'read contact', capability: 'contact.read', run: async () => routes.readContact!(await request('GET', '/contact-messages/' + MESSAGE), ctx(MESSAGE)) },
  ];
}

test('CAPABILITY MATRIX: owner and customer_support may use every support route; finance and operations are refused on every one (403 CAPABILITY_REQUIRED) and the seller backend is never called', async () => {
  for (const allowed of ['owner', 'customer_support', undefined]) {
    level = allowed;
    for (const route of await everyRoute()) {
      calls = [];
      const res = await route.run();
      assert.equal(res.status, 200, String(allowed) + ' ' + route.name);
      assert.equal(calls.length, 1, String(allowed) + ' ' + route.name + ': one signed call');
    }
  }
  for (const refused of ['finance', 'operations']) {
    level = refused;
    for (const route of await everyRoute()) {
      calls = [];
      audits = [];
      const res = await route.run();
      assert.equal(res.status, 403, refused + ' ' + route.name);
      assert.equal(((await res.json()) as { code?: string }).code, 'CAPABILITY_REQUIRED');
      assert.equal(calls.length, 0, refused + ' ' + route.name + ': nothing was sent');
      assert.equal(audits.length, 0);
    }
  }
  level = 'a_level_nobody_defined';
  for (const route of await everyRoute()) assert.equal((await route.run()).status, 403, 'an unknown level is denied everything: ' + route.name);
});

test('each route needs the capability the task names: tickets.read, tickets.reply, contact.read', async () => {
  const { adminCan } = await import('@/lib/workspace');
  for (const route of await everyRoute()) {
    for (const lvl of ['owner', 'customer_support'] as const) assert.equal((adminCan as any)(lvl, route.capability), true, lvl + ' ' + route.capability);
    for (const lvl of ['finance', 'operations'] as const) assert.equal((adminCan as any)(lvl, route.capability), false, lvl + ' ' + route.capability);
  }
});

test('no session is 401 and a seller session is 401 on every route', async () => {
  const noToken = await routes.listTickets!(await request('GET', '/tickets', undefined, null));
  assert.equal(noToken.status, 401);
  const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
  assert.equal((await routes.reply!(await request('POST', '/tickets/' + TICKET + '/reply', { revision: 0, text: 'x' }, seller), ctx(TICKET))).status, 401);
  assert.equal(calls.length, 0);
});

test('list: ONE signed call with the filters; the seller backend answer is passed through', async () => {
  answer = { status: 200, body: { docs: [{ id: TICKET, subject: 'Payout', sellerName: 'Zara' }], page: 1, limit: 20, totalDocs: 1, totalPages: 1 } };
  const res = await routes.listTickets!(await request('GET', '/tickets?status=open&page=2&limit=10'));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).docs[0].sellerName, 'Zara');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, '/api/internal/support/tickets/list');
  const body = String(calls[0]!.init.body);
  assert.deepEqual(JSON.parse(body), { status: 'open', page: 2, limit: 10 });
  assert.equal(verify(calls[0]!, body), true, 'signed with the shared secret, naming the operator');
  assert.equal(new Headers(calls[0]!.init.headers).get('cookie'), null, 'no session cookie is forwarded');
});

test('a bad filter is 400 naming the field and nothing is sent', async () => {
  for (const query of ['?status=nonsense', '?limit=500', '?page=0', '?extra=1']) {
    const res = await routes.listTickets!(await request('GET', '/tickets' + query));
    assert.equal(res.status, 400, query);
  }
  assert.equal((await routes.listContact!(await request('GET', '/contact-messages?status=bogus'))).status, 400);
  assert.equal(calls.length, 0);
});

test('detail: a bad id is 404 without a call; the seller backend 404 is passed on', async () => {
  assert.equal((await routes.readTicket!(await request('GET', '/tickets/not-an-id'), ctx('not-an-id'))).status, 404);
  assert.equal((await routes.readContact!(await request('GET', '/contact-messages/not-an-id'), ctx('not-an-id'))).status, 404);
  assert.equal(calls.length, 0);
  answer = { status: 404, body: { errors: [{ message: 'Ticket not found' }] } };
  assert.equal((await routes.readTicket!(await request('GET', '/tickets/' + TICKET), ctx(TICKET))).status, 404);
});

test('reply: the operator is the session, never the body; ONE signed call with the revision and the text; the audit entry holds the ids, not the text', async () => {
  answer = { status: 200, body: { ticket: { id: TICKET, status: 'answered', revision: 1 } } };
  const res = await routes.reply!(await request('POST', '/tickets/' + TICKET + '/reply', { revision: 0, text: 'We paid it on Friday. <b>Sorry</b>' }), ctx(TICKET));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, '/api/internal/support/tickets/reply');
  const sent = String(calls[0]!.init.body);
  assert.deepEqual(JSON.parse(sent), { id: TICKET, revision: 0, text: 'We paid it on Friday. <b>Sorry</b>' });
  assert.equal(verify(calls[0]!, sent), true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]![0], 'ticket.reply');
  assert.equal(audits[0]![2], TICKET);
  assert.equal(audits[0]![3], ADMIN_ID);
  assert.equal(JSON.stringify(audits[0]).includes('We paid it'), false, 'the text is not in the audit log');
});

test('a body that names another operator, or any key that is not listed, is refused before any call', async () => {
  const cases: Array<[unknown, string]> = [
    [{ revision: 0, text: 'x', adminId: '65a000000000000000000099' }, 'adminId'],
    [{ revision: 0, text: 'x', byId: 'someone' }, 'byId'],
    [{ revision: 0, text: 'x', status: 'closed' }, 'status'],
    [{ text: 'no revision' }, 'revision'],
    [{ revision: 0 }, 'text'],
    [{ revision: 0, text: '' }, 'text'],
    [{ revision: 0, text: 'x'.repeat(3001) }, 'text'],
  ];
  for (const [body, field] of cases) {
    const res = await routes.reply!(await request('POST', '/tickets/' + TICKET + '/reply', body), ctx(TICKET));
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(((await res.json()) as { field?: string }).field, field);
  }
  assert.equal(calls.length, 0);
  assert.equal(audits.length, 0);
});

test('the seller backend refusals reach the operator: a stale revision and a closed ticket are 409 with their codes, and a refused reply is NOT audited', async () => {
  for (const code of ['TICKET_REVISION_CONFLICT', 'TICKET_CLOSED']) {
    answer = { status: 409, body: { errors: [{ message: 'Refused' }], code } };
    const res = await routes.reply!(await request('POST', '/tickets/' + TICKET + '/reply', { revision: 0, text: 'Hello' }), ctx(TICKET));
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code?: string }).code, code);
  }
  assert.equal(audits.length, 0);
});

test('status change: ONE signed call, audited with the new status; a bad status is 400', async () => {
  answer = { status: 200, body: { ticket: { id: TICKET, status: 'closed', revision: 1 } } };
  const res = await routes.status!(await request('POST', '/tickets/' + TICKET + '/status', { revision: 0, status: 'closed' }), ctx(TICKET));
  assert.equal(res.status, 200);
  assert.equal(new URL(calls[0]!.url).pathname, '/api/internal/support/tickets/status');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { id: TICKET, revision: 0, status: 'closed' });
  assert.equal(audits[0]![0], 'ticket.status');
  assert.equal(audits[0]![4].status, 'closed');
  const bad = await routes.status!(await request('POST', '/tickets/' + TICKET + '/status', { revision: 0, status: 'deleted' }), ctx(TICKET));
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 1);
});

test('a failing audit never undoes a reply that was made, and an unreachable seller backend is a 503', async () => {
  supportSteps.audit = (async () => {
    throw new Error('audit down');
  }) as any;
  answer = { status: 200, body: { ticket: { id: TICKET, status: 'answered' } } };
  assert.equal((await routes.reply!(await request('POST', '/tickets/' + TICKET + '/reply', { revision: 0, text: 'Hello' }), ctx(TICKET))).status, 200);
  answer = 'down';
  assert.equal((await routes.listTickets!(await request('GET', '/tickets'))).status, 503);
});

test('platform contact messages: list and detail through the contact.read capability, one signed call each', async () => {
  answer = { status: 200, body: { docs: [{ id: MESSAGE, message: 'Platform hello' }], page: 1, limit: 20, totalDocs: 1, totalPages: 1 } };
  const list = await routes.listContact!(await request('GET', '/contact-messages?status=new'));
  assert.equal(list.status, 200);
  assert.equal(new URL(calls[0]!.url).pathname, '/api/internal/support/contact/list');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { status: 'new' });
  answer = { status: 200, body: { message: { id: MESSAGE } } };
  assert.equal((await routes.readContact!(await request('GET', '/contact-messages/' + MESSAGE), ctx(MESSAGE))).status, 200);
  assert.equal(new URL(calls[1]!.url).pathname, '/api/internal/support/contact/detail');
  assert.equal(audits.length, 0, 'reading is not audited');
});
