import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { AuditLog, ContactMessage, NotificationOutbox, Store, SupportTicket, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';
import { sendTicketAdminReply } from '../src/lib/tickets';
import { ticketToWire } from '../src/lib/support';

// Sprint 7 (S7-B4): the seller's support tickets (own only), and the admin's signed internal calls. Models are stubbed; no database.

const SECRET = 'x'.repeat(40);
const MOD = 'm'.repeat(40);
const oid = (n: number): string => n.toString(16).padStart(24, '0');
const USER_A = oid(1);
const USER_B = oid(2);
const ADMIN_USER = oid(3);
const ADMIN_ID = oid(900);
const STORE_A = oid(11);
const STORE_B = oid(12);
const TK_A = oid(401);
const TK_B = oid(402);
const MSG_PLATFORM = oid(501);
const MSG_STORE = oid(502);
const T0 = new Date('2026-11-01T10:00:00Z');

const TicketModel = SupportTicket as any;
const ContactModel = ContactMessage as any;
const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;
const OutboxModel = NotificationOutbox as any;

let tickets: Array<Record<string, any>> = [];
let contacts: Array<Record<string, any>> = [];
let outbox: Array<Record<string, any>> = [];
let audits: Array<Record<string, any>> = [];
let updates: Array<{ filter: any; update: any }> = [];
let creates = 0;
let nextId = 7000;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};

type Ctx = { params: Promise<Record<string, string>> };
let list: { GET: (r: NextRequest) => Promise<Response>; POST: (r: NextRequest) => Promise<Response> };
let item: { GET: (r: NextRequest, c: Ctx) => Promise<Response> };
let replyRoute: { POST: (r: NextRequest, c: Ctx) => Promise<Response> };
let closeRoute: { POST: (r: NextRequest, c: Ctx) => Promise<Response> };
const internal: Record<string, (r: NextRequest) => Promise<Response>> = {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN_USER, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  list = (await import('../src/app/api/tickets/route')) as any;
  item = (await import('../src/app/api/tickets/[id]/route')) as any;
  replyRoute = (await import('../src/app/api/tickets/[id]/reply/route')) as any;
  closeRoute = (await import('../src/app/api/tickets/[id]/close/route')) as any;
  for (const name of ['tickets/list', 'tickets/detail', 'tickets/reply', 'tickets/status', 'contact/list', 'contact/detail']) {
    internal[name] = (await import('../src/app/api/internal/support/' + name + '/route')).POST as any;
  }
});

const lean = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};
const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const matches = (row: Record<string, any>, filter: Record<string, any>): boolean =>
  Object.entries(filter).every(([key, cond]) => (cond !== null && typeof cond === 'object' && '$in' in cond ? (cond.$in as unknown[]).map(String).includes(String(row[key])) : String(row[key]) === String(cond)));

const ticket = (over: Record<string, any>): Record<string, any> => ({
  _id: oid(nextId++),
  seller: USER_A,
  store: null,
  subject: 'My payout is late',
  messages: [{ from: 'seller', text: 'Where is my payout?', at: T0, byId: USER_A }],
  status: 'open',
  orderRef: null,
  revision: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

beforeEach(() => {
  tickets = [ticket({ _id: TK_A }), ticket({ _id: TK_B, seller: USER_B, subject: 'B private subject', messages: [{ from: 'seller', text: 'B private text', at: T0, byId: USER_B }] })];
  contacts = [
    { _id: MSG_PLATFORM, scope: 'platform', store: null, name: 'Visitor', email: 'v@example.com', phone: null, message: 'Platform hello', status: 'new', consent: true, replies: [], revision: 0, createdAt: T0, updatedAt: T0 },
    { _id: MSG_STORE, scope: 'store', store: STORE_A, name: 'Shopper', email: 'sh@example.com', phone: null, message: 'Store only message', status: 'new', consent: true, replies: [], revision: 0, createdAt: T0, updatedAt: T0 },
  ];
  outbox = [];
  audits = [];
  updates = [];
  creates = 0;
  process.env.MODERATION_API_SECRET = MOD;
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  delete process.env.EMAIL_PROVIDER;
  resetRateLimits();
  const saved = {
    connect: (mongoose as any).connect,
    ticket: Object.fromEntries(['find', 'findOne', 'countDocuments', 'create', 'updateOne'].map((m) => [m, TicketModel[m]])),
    contact: Object.fromEntries(['find', 'findOne', 'countDocuments'].map((m) => [m, ContactModel[m]])),
    store: Object.fromEntries(['exists', 'findOne'].map((m) => [m, StoreModel[m]])),
    user: Object.fromEntries(['find', 'findById'].map((m) => [m, UserModel[m]])),
    audit: AuditModel.create,
    outbox: Object.fromEntries(['create', 'findOne', 'findOneAndUpdate'].map((m) => [m, OutboxModel[m]])),
  };
  (mongoose as any).connect = async () => mongoose;
  TicketModel.create = async (doc: Record<string, any>) => {
    creates += 1;
    const row = { _id: oid(nextId++), ...structuredClone(doc), createdAt: T0, updatedAt: T0 };
    tickets.push(row);
    return row;
  };
  TicketModel.findOne = (filter: any) => lean(() => structuredClone(tickets.find((r) => matches(r, filter)) ?? null));
  TicketModel.find = (filter: any) => lean(() => structuredClone(tickets.filter((r) => matches(r, filter))));
  TicketModel.countDocuments = async (filter: any) => tickets.filter((r) => matches(r, filter)).length;
  TicketModel.updateOne = async (filter: any, update: any) => {
    updates.push({ filter, update });
    const row = tickets.find((r) => matches(r, { _id: filter._id, ...(filter.seller === undefined ? {} : { seller: filter.seller }) }));
    if (!row) return { matchedCount: 0 };
    const want = filter.revision;
    const have = row.revision ?? null;
    const ok = want !== null && typeof want === 'object' && '$in' in want ? (want.$in as unknown[]).includes(have) : have === want;
    if (!ok) return { matchedCount: 0 };
    Object.assign(row, structuredClone(update.$set ?? {}));
    if (update.$push?.messages) row.messages.push(structuredClone(update.$push.messages));
    row.revision = (row.revision ?? 0) + (update.$inc?.revision ?? 0);
    row.updatedAt = new Date(T0.getTime() + 5000);
    return { matchedCount: 1 };
  };
  ContactModel.findOne = (filter: any) => lean(() => structuredClone(contacts.find((r) => matches(r, filter)) ?? null));
  ContactModel.find = (filter: any) => lean(() => structuredClone(contacts.filter((r) => matches(r, filter))));
  ContactModel.countDocuments = async (filter: any) => contacts.filter((r) => matches(r, filter)).length;
  StoreModel.exists = async (filter: any) => ((String(filter._id) === STORE_A && String(filter.owner) === USER_A) || (String(filter._id) === STORE_B && String(filter.owner) === USER_B) ? { _id: filter._id } : null);
  StoreModel.findOne = () => lean(() => ({ _id: STORE_A }));
  UserModel.find = () => lean(() => [{ _id: USER_A, name: 'Zara Owner', email: 'zara@example.com' }, { _id: USER_B, name: 'Bilal Owner', email: 'bilal@example.com' }]);
  UserModel.findById = (id: string) => lean(() => (String(id) === USER_A ? { _id: USER_A, name: 'Zara Owner', email: 'zara@example.com' } : null));
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  OutboxModel.create = async (doc: Record<string, any>) => {
    if (doc.dedupeKey !== undefined && outbox.some((r) => r.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    outbox.push(row);
    return row;
  };
  OutboxModel.findOne = (filter: any) => lean(() => outbox.find((r) => r.dedupeKey === filter.dedupeKey) ?? null);
  OutboxModel.findOneAndUpdate = () => lean(() => null);
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.ticket)) TicketModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.contact)) ContactModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.user)) UserModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.outbox)) OutboxModel[m] = fn;
    AuditModel.create = saved.audit;
    delete process.env.MODERATION_API_SECRET;
    delete process.env.APP_BASE_URL_SELLER;
  };
});

afterEach(() => restore());

type Opts = { token?: string | null; body?: unknown; raw?: string };
const req = (method: string, path: string, opts: Opts = {}) => {
  const { token = tokenA, body, raw } = opts;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = 'Bearer ' + token;
  return new NextRequest('http://seller.test/api/tickets' + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
};
const ctxOf = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const create = (body: unknown, opts: Opts = {}) => list.POST(req('POST', '', { ...opts, body }));
const mine = (query = '', opts: Opts = {}) => list.GET(req('GET', query, opts));
const read = (id: string, opts: Opts = {}) => item.GET(req('GET', '/' + id, opts), ctxOf(id));
const reply = (id: string, body: unknown, opts: Opts = {}) => replyRoute.POST(req('POST', '/' + id + '/reply', { ...opts, body }), ctxOf(id));
const close = (id: string, body: unknown, opts: Opts = {}) => closeRoute.POST(req('POST', '/' + id + '/close', { ...opts, body }), ctxOf(id));
const row = (id: string): Record<string, any> => tickets.find((r) => r._id === id)!;
type Body = Record<string, any>;

// ------------------------------------------------------------------------------------------------------------------------- seller routes

test('a seller opens a ticket: subject and first message, open, revision 0, their own, audited', async () => {
  const res = await create({ subject: 'Payout question', message: 'When is my next payout?', orderRef: 'ORD-ABCD2345' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Body;
  assert.equal(body.subject, 'Payout question');
  assert.equal(body.status, 'open');
  assert.equal(body.revision, 0);
  assert.equal(body.orderRef, 'ORD-ABCD2345');
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].from, 'seller');
  assert.equal(body.messages[0].text, 'When is my next payout?');
  assert.equal(String(tickets.at(-1)!.seller), USER_A, 'the owner is the session, never the body');
  assert.equal(audits.at(-1)!.action, 'ticket.create');
});

test('a ticket may name one of the seller\'s own stores, never another seller\'s', async () => {
  assert.equal((await create({ subject: 'About my store', message: 'Please help', store: STORE_A })).status, 201);
  const foreign = await create({ subject: 'About that store', message: 'Please help', store: STORE_B });
  assert.equal(foreign.status, 403);
  assert.equal(creates, 1);
});

test('a bad ticket is 400 TICKET_INVALID with the field, and nothing is stored', async () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'subject'],
    [{ subject: 'ab', message: 'Please help' }, 'subject'],
    [{ subject: 'x'.repeat(151), message: 'Please help' }, 'subject'],
    [{ subject: 'Fine subject' }, 'message'],
    [{ subject: 'Fine subject', message: 'hi' }, 'message'],
    [{ subject: 'Fine subject', message: 'x'.repeat(3001) }, 'message'],
    [{ subject: 'Fine subject', message: 'Please help', orderRef: 'x'.repeat(41) }, 'orderRef'],
    [{ subject: 'Fine subject', message: 'Please help', store: 'nope' }, 'store'],
    [{ subject: 'Fine subject', message: 'Please help', seller: USER_B }, 'seller'],
    [{ subject: 'Fine subject', message: 'Please help', status: 'closed' }, 'status'],
    [{ subject: 'Fine subject', message: 'Please help', messages: [] }, 'messages'],
  ];
  for (const [body, field] of cases) {
    resetRateLimits();
    const res = await create(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 70));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'TICKET_INVALID');
    assert.equal(out.field, field, JSON.stringify(body).slice(0, 70));
  }
  resetRateLimits();
  assert.equal((await create(undefined, { raw: 'not json' })).status, 400);
  assert.equal(creates, 0);
});

test('ticket writes are rate limited per seller: the 11th in ten minutes is 429, and another seller is not affected', async () => {
  for (let i = 0; i < 10; i += 1) assert.equal((await create({ subject: 'Subject ' + i, message: 'Please help me' })).status, 201, 'ticket ' + i);
  const eleventh = await create({ subject: 'One too many', message: 'Please help me' });
  assert.equal(eleventh.status, 429);
  assert.ok(Number(eleventh.headers.get('retry-after')) >= 1);
  assert.equal((await create({ subject: 'Seller B asks', message: 'Please help me' }, { token: tokenB })).status, 201);
  assert.equal((await reply(TK_A, { revision: 0, text: 'Another message' })).status, 429, 'replies count too');
});

test('no session is 401 and an admin session is 403 on every ticket route', async () => {
  for (const token of [null, tokenAdmin]) {
    const want = token === null ? 401 : 403;
    assert.equal((await mine('', { token })).status, want);
    assert.equal((await create({ subject: 'Fine subject', message: 'Please help' }, { token })).status, want);
    assert.equal((await read(TK_A, { token })).status, want);
    assert.equal((await reply(TK_A, { revision: 0, text: 'Hi there' }, { token })).status, want);
    assert.equal((await close(TK_A, { revision: 0 }, { token })).status, want);
  }
  assert.equal(creates, 0);
  assert.equal(updates.length, 0);
});

test('the list holds the seller\'s OWN tickets only, without their messages, and filters by status', async () => {
  tickets.push(ticket({ status: 'closed', subject: 'Old closed one' }));
  const all = (await (await mine()).json()) as Body;
  assert.equal(all.totalDocs, 2);
  assert.ok(all.docs.every((d: Body) => !('messages' in d) && typeof d.messageCount === 'number'));
  assert.equal(JSON.stringify(all).includes('B private'), false);
  const closed = (await (await mine('?status=closed')).json()) as Body;
  assert.deepEqual(closed.docs.map((d: Body) => d.subject), ['Old closed one']);
  assert.equal((await mine('?status=nonsense')).status, 422);
  const theirs = (await (await mine('', { token: tokenB })).json()) as Body;
  assert.deepEqual(theirs.docs.map((d: Body) => d.id), [TK_B]);
});

test('another seller\'s ticket is a 404 for detail, reply and close (its contents are never returned), and nothing changes; a bad id is 404 too', async () => {
  const peek = await read(TK_B);
  assert.equal(peek.status, 404);
  const text = await peek.text();
  assert.equal(text.includes('B private'), false);
  assert.equal((await reply(TK_B, { revision: 0, text: 'Hijack' })).status, 404);
  assert.equal((await close(TK_B, { revision: 0 })).status, 404);
  assert.equal((await read('not-an-id')).status, 404);
  assert.equal((await read(oid(999))).status, 404);
  assert.equal(row(TK_B).status, 'open');
  assert.equal(row(TK_B).messages.length, 1);
  assert.equal(((await (await read(TK_A)).json()) as Body).messages[0].text, 'Where is my payout?');
});

test('reply and close are ONE compare-and-set on the revision; a stale write is 409 TICKET_REVISION_CONFLICT; a closed ticket takes no reply (409 TICKET_CLOSED)', async () => {
  const res = await reply(TK_A, { revision: 0, text: 'Any news?' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.revision, 1);
  assert.equal(body.status, 'open');
  assert.equal(body.messages.length, 2);
  assert.deepEqual(updates[0]!.filter, { _id: TK_A, seller: USER_A, revision: { $in: [0, null] } });
  const stale = await reply(TK_A, { revision: 0, text: 'From an old tab' });
  assert.equal(stale.status, 409);
  const conflict = (await stale.json()) as Body;
  assert.equal(conflict.code, 'TICKET_REVISION_CONFLICT');
  assert.equal(conflict.currentRevision, 1);
  assert.equal(row(TK_A).messages.length, 2);
  const closed = await close(TK_A, { revision: 1 });
  assert.equal(closed.status, 200);
  assert.equal(((await closed.json()) as Body).status, 'closed');
  const afterClose = await reply(TK_A, { revision: 2, text: 'Too late' });
  assert.equal(afterClose.status, 409);
  assert.equal(((await afterClose.json()) as Body).code, 'TICKET_CLOSED');
  assert.equal((await close(TK_A, { revision: 0 })).status, 409, 'a stale close is a conflict too');
});

test('reply and close refuse a bad body with 400 TICKET_INVALID and the field', async () => {
  const cases: Array<[unknown, string]> = [
    [{ text: 'No revision' }, 'revision'],
    [{ revision: 0 }, 'text'],
    [{ revision: 0, text: '' }, 'text'],
    [{ revision: 0, text: 'x'.repeat(3001) }, 'text'],
    [{ revision: 0, text: 'Hi', from: 'admin' }, 'from'],
    [{ revision: 0, text: 'Hi', status: 'answered' }, 'status'],
  ];
  for (const [body, field] of cases) {
    resetRateLimits();
    const res = await reply(TK_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(((await res.json()) as Body).field, field);
  }
  resetRateLimits();
  const bad = await close(TK_A, { revision: 0, status: 'open' });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as Body).code, 'TICKET_INVALID');
  assert.equal(updates.length, 0);
});

test('text is stored as plain text, exactly as typed, and sent back as data (the screens escape it; the email template escapes it too)', async () => {
  const nasty = '<script>alert(1)</script> <img src=x onerror=alert(2)> & "quotes"';
  const res = await create({ subject: 'Escape <b>test</b>', message: nasty });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Body;
  assert.equal(body.subject, 'Escape <b>test</b>');
  assert.equal(body.messages[0].text, nasty);
  assert.equal(String(tickets.at(-1)!.messages[0].text), nasty);
  assert.equal(ticketToWire({ _id: 'x', subject: 's', status: 'open', messages: [{ from: 'seller', text: nasty, at: T0, byId: 'u' }] }).messageCount, 1);
  await sendTicketAdminReply({ id: TK_A, seller: USER_A, store: null, subject: 'Escape <b>test</b>', revision: 1 }, nasty);
  const mail = outbox.find((r) => r.template === 'ticket_admin_reply')!;
  assert.equal(String(mail.bodyHtml).includes('<script>'), false);
  assert.equal(String(mail.bodyHtml).includes('<img'), false);
  assert.ok(String(mail.bodyHtml).includes('&lt;script&gt;'));
});

// ------------------------------------------------------------------------------------------------------------ the admin's signed calls

function signed(name: string, body: unknown, options: { secret?: string; tamper?: boolean } = {}): NextRequest {
  const path = '/api/internal/support/' + name;
  const raw = JSON.stringify(body);
  const headers = internalRequestHeaders(options.secret ?? MOD, { method: 'POST', path, adminId: ADMIN_ID, body: options.tamper ? raw + ' ' : raw });
  return new NextRequest('http://seller.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
}
const call = (name: string, body: unknown, options?: { secret?: string; tamper?: boolean }) => internal[name]!(signed(name, body, options));

test('the internal support calls answer only a request signed with the shared secret: no signature, a wrong secret or a tampered body is 401', async () => {
  for (const name of Object.keys(internal)) {
    const unsigned = await internal[name]!(new NextRequest('http://seller.test/api/internal/support/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(unsigned.status, 401, name + ' unsigned');
    assert.equal((await call(name, {}, { secret: 'w'.repeat(40) })).status, 401, name + ' wrong secret');
    assert.equal((await call(name, {}, { tamper: true })).status, 401, name + ' tampered');
  }
  assert.equal((await internal['tickets/list']!(new NextRequest('http://seller.test/api/internal/support/tickets/list', { method: 'POST', headers: { authorization: 'Bearer ' + tokenAdmin, 'content-type': 'application/json' }, body: '{}' }))).status, 401, 'a seller or admin SESSION means nothing here');
});

test('admin list: every seller\'s tickets with the seller\'s name, filtered by status; detail with all messages', async () => {
  const body = (await (await call('tickets/list', {})).json()) as Body;
  assert.equal(body.totalDocs, 2);
  assert.deepEqual(body.docs.map((d: Body) => d.sellerName).sort(), ['Bilal Owner', 'Zara Owner']);
  assert.ok(body.docs.every((d: Body) => !('messages' in d)));
  assert.equal(((await (await call('tickets/list', { status: 'closed' })).json()) as Body).totalDocs, 0);
  const detail = (await (await call('tickets/detail', { id: TK_B })).json()) as Body;
  assert.equal(detail.ticket.messages[0].text, 'B private text');
  assert.equal(detail.ticket.sellerEmail, 'bilal@example.com');
  assert.equal((await call('tickets/detail', { id: oid(999) })).status, 404);
  assert.equal((await call('tickets/detail', { id: 'not-an-id' })).status, 422);
  assert.equal((await call('tickets/list', { unknown: 1 })).status, 422);
});

test('admin reply: a message from the admin, status answered, ONE compare-and-set, one email to the seller; a stale revision is 409; a closed ticket is 409', async () => {
  const res = await call('tickets/reply', { id: TK_A, revision: 0, text: 'We paid it on Friday.' });
  assert.equal(res.status, 200);
  const { ticket: t } = (await res.json()) as Body;
  assert.equal(t.status, 'answered');
  assert.equal(t.revision, 1);
  assert.deepEqual(t.messages.at(-1), { from: 'admin', text: 'We paid it on Friday.', at: t.messages.at(-1).at, byId: ADMIN_ID });
  assert.deepEqual(updates[0]!.filter, { _id: TK_A, revision: { $in: [0, null] } });
  await sendTicketAdminReply({ id: TK_A, seller: USER_A, store: null, subject: 'My payout is late', revision: 1 }, 'We paid it on Friday.');
  const mails = outbox.filter((r) => r.template === 'ticket_admin_reply');
  assert.equal(mails.length, 1);
  assert.equal(mails[0]!.to, 'zara@example.com');
  assert.ok(String(mails[0]!.bodyText).includes('We paid it on Friday.'));
  const stale = await call('tickets/reply', { id: TK_A, revision: 0, text: 'Second' });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as Body).code, 'TICKET_REVISION_CONFLICT');
  assert.equal(row(TK_A).messages.length, 2);
  row(TK_A).status = 'closed';
  const closed = await call('tickets/reply', { id: TK_A, revision: 1, text: 'Third' });
  assert.equal(closed.status, 409);
  assert.equal(((await closed.json()) as Body).code, 'TICKET_CLOSED');
  assert.equal((await call('tickets/reply', { id: TK_A, revision: 1, text: '' })).status, 422);
  assert.equal((await call('tickets/reply', { id: oid(999), revision: 0, text: 'Hello' })).status, 404);
});

test('a seller who answers an answered ticket puts it back to open, so the platform sees it again', async () => {
  assert.equal((await call('tickets/reply', { id: TK_A, revision: 0, text: 'Answer' })).status, 200);
  const res = await reply(TK_A, { revision: 1, text: 'Thanks, one more question' });
  assert.equal(((await res.json()) as Body).status, 'open');
});

test('admin status change: open, answered or closed under a compare-and-set; a stale revision is 409; a bad status is 422', async () => {
  const res = await call('tickets/status', { id: TK_A, revision: 0, status: 'closed' });
  assert.equal(res.status, 200);
  assert.equal((((await res.json()) as Body).ticket as Body).status, 'closed');
  assert.equal((await call('tickets/status', { id: TK_A, revision: 1, status: 'open' })).status, 200, 'an admin may reopen');
  const stale = await call('tickets/status', { id: TK_A, revision: 0, status: 'closed' });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as Body).code, 'TICKET_REVISION_CONFLICT');
  assert.equal((await call('tickets/status', { id: TK_A, revision: 2, status: 'deleted' })).status, 422);
});

test('the admin contact inbox lists PLATFORM messages only and never a store\'s', async () => {
  const body = (await (await call('contact/list', {})).json()) as Body;
  assert.deepEqual(body.docs.map((d: Body) => d.id), [MSG_PLATFORM]);
  assert.equal(JSON.stringify(body).includes('Store only message'), false);
  const detail = (await (await call('contact/detail', { id: MSG_PLATFORM })).json()) as Body;
  assert.equal(detail.message.message, 'Platform hello');
  assert.equal((await call('contact/detail', { id: MSG_STORE })).status, 404, 'a store\'s message is the seller\'s, not the admin\'s');
  assert.equal((await call('contact/detail', { id: oid(999) })).status, 404);
});

test('what the seller reads back never carries the account id of the platform member who answered; the admin still has it', async () => {
  const answered = (await (await call('tickets/reply', { id: TK_A, revision: 0, text: 'We paid it on Friday.' })).json()) as Body;
  assert.equal(answered.ticket.messages.at(-1).byId, ADMIN_ID, 'the admin view');
  const mine = await read(TK_A);
  const text = await mine.text();
  assert.equal(mine.status, 200);
  assert.equal(text.includes(ADMIN_ID), false);
  assert.deepEqual(JSON.parse(text).messages.map((m: Body) => [m.from, m.byId]), [['seller', USER_A], ['admin', '']]);
});
