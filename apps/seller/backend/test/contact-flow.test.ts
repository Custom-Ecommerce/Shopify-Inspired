import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, ContactMessage, NotificationOutbox, PlatformSettingsModel, SellerAlert, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';
import { sendContactReply, sendPlatformContactNotice, sendStoreContactNotices } from '../src/lib/contact';
import { contactToWire, whatsappLink } from '../src/lib/support';

// Sprint 7 (S7-B4): the public contact forms (store and platform), the seller's inbox (list, detail, mark read, reply, close) and what happens after a message
// is stored. Models are stubbed; no database. The limiter runs on in-process counters.

const SECRET = 'x'.repeat(40);
const oid = (n: number): string => n.toString(16).padStart(24, '0');
const USER_A = oid(1);
const USER_B = oid(2);
const ADMIN = oid(3);
const STORE_A = oid(11);
const STORE_B = oid(12);
const STORE_PENDING = oid(13);
const MSG_A = oid(301);
const MSG_A_PHONE = oid(302);
const MSG_B = oid(303);
const MSG_PLATFORM = oid(304);
const T0 = new Date('2026-11-01T10:00:00Z');

const ContactModel = ContactMessage as any;
const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;
const OutboxModel = NotificationOutbox as any;
const AlertModel = SellerAlert as any;
const SettingsModel = PlatformSettingsModel as any;

let messages: Array<Record<string, any>> = [];
let stores: Record<string, Record<string, any>> = {};
let audits: Array<Record<string, any>> = [];
let outbox: Array<Record<string, any>> = [];
let alerts: Array<Record<string, any>> = [];
let creates = 0;
let updates: Array<{ filter: any; update: any }> = [];
let failCreate = false;
let supportEmail: string | null = null;
let nextId = 5000;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};

type Ctx = { params: Promise<Record<string, string>> };
let storeContact: (r: NextRequest, c: Ctx) => Promise<Response>;
let platformContact: (r: NextRequest) => Promise<Response>;
let inbox: { GET: (r: NextRequest) => Promise<Response> };
let inboxItem: { GET: (r: NextRequest, c: Ctx) => Promise<Response>; PATCH: (r: NextRequest, c: Ctx) => Promise<Response> };
let inboxReply: { POST: (r: NextRequest, c: Ctx) => Promise<Response> };

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  storeContact = (await import('../src/app/api/storefront/v1/stores/[id]/contact/route')).POST as any;
  platformContact = (await import('../src/app/api/storefront/v1/contact/route')).POST as any;
  inbox = (await import('../src/app/api/contactMessages/route')) as any;
  inboxItem = (await import('../src/app/api/contactMessages/[id]/route')) as any;
  inboxReply = (await import('../src/app/api/contactMessages/[id]/reply/route')) as any;
});

const lean = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};
const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && '$in' in cond) return (cond.$in as unknown[]).map(String).includes(String(row[key]));
    return String(row[key]) === String(cond);
  });
}

const msg = (over: Record<string, any>): Record<string, any> => ({
  _id: oid(nextId++),
  scope: 'store',
  store: STORE_A,
  name: 'Sara Khan',
  email: 'sara@example.com',
  phone: null,
  message: 'Do you deliver to Quetta?',
  status: 'new',
  consent: true,
  replies: [],
  revision: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

beforeEach(() => {
  messages = [
    msg({ _id: MSG_A }),
    msg({ _id: MSG_A_PHONE, email: '', phone: '0300 1234567', name: 'Ali', createdAt: new Date(T0.getTime() + 1000) }),
    msg({ _id: MSG_B, store: STORE_B, name: 'Bilal customer', message: 'secret of store B' }),
    msg({ _id: MSG_PLATFORM, scope: 'platform', store: null, name: 'Visitor', message: 'platform only' }),
  ];
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, slug: 'zara', name: 'Zara Lawn', status: 'active', storefront: {}, paymentSettings: {} },
    [STORE_B]: { _id: STORE_B, owner: USER_B, slug: 'bilal', name: 'Bilal Shoes', status: 'active', storefront: {}, paymentSettings: {} },
    [STORE_PENDING]: { _id: STORE_PENDING, owner: USER_B, slug: 'soon', name: 'Soon', status: 'pending', storefront: {}, paymentSettings: {} },
  };
  audits = [];
  outbox = [];
  alerts = [];
  updates = [];
  creates = 0;
  failCreate = false;
  supportEmail = 'support@markazify.com';
  resetRateLimits();
  const saved = {
    connect: (mongoose as any).connect,
    contact: Object.fromEntries(['find', 'findOne', 'countDocuments', 'create', 'updateOne'].map((m) => [m, ContactModel[m]])),
    store: Object.fromEntries(['findById', 'findOne', 'exists'].map((m) => [m, StoreModel[m]])),
    user: UserModel.findById,
    audit: AuditModel.create,
    outbox: Object.fromEntries(['create', 'findOne', 'findOneAndUpdate'].map((m) => [m, OutboxModel[m]])),
    alert: AlertModel.create,
    settings: SettingsModel.findOne,
  };
  (mongoose as any).connect = async () => mongoose;
  ContactModel.create = async (doc: Record<string, any>) => {
    creates += 1;
    if (failCreate) throw new Error('database down');
    const row = { _id: oid(nextId++), ...structuredClone(doc), createdAt: T0, updatedAt: T0 };
    messages.push(row);
    return row;
  };
  ContactModel.findOne = (filter: any) => lean(() => structuredClone(messages.find((row) => matches(row, filter)) ?? null));
  ContactModel.find = (filter: any) => lean(() => structuredClone(messages.filter((row) => matches(row, filter)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())));
  ContactModel.countDocuments = async (filter: any) => messages.filter((row) => matches(row, filter)).length;
  ContactModel.updateOne = async (filter: any, update: any) => {
    updates.push({ filter, update });
    const row = messages.find((r) => String(r._id) === String(filter._id) && String(r.store) === String(filter.store) && r.scope === filter.scope);
    if (!row) return { matchedCount: 0 };
    const want = filter.revision;
    const have = row.revision ?? null;
    const ok = want !== null && typeof want === 'object' && '$in' in want ? (want.$in as unknown[]).includes(have) : have === want;
    if (!ok) return { matchedCount: 0 };
    Object.assign(row, structuredClone(update.$set ?? {}));
    if (update.$push?.replies) row.replies.push(structuredClone(update.$push.replies));
    row.revision = (row.revision ?? 0) + (update.$inc?.revision ?? 0);
    row.updatedAt = new Date(T0.getTime() + 5000);
    return { matchedCount: 1 };
  };
  StoreModel.findById = (id: unknown) => lean(() => (stores[String(id)] ? structuredClone(stores[String(id)]) : null));
  StoreModel.findOne = (filter: any) => lean(() => (stores[String(filter._id)] ? structuredClone(stores[String(filter._id)]) : null));
  StoreModel.exists = async (filter: any) => (stores[String(filter._id)] && String(stores[String(filter._id)]!.owner) === String(filter.owner) ? { _id: filter._id } : null);
  UserModel.findById = (id: string) => lean(() => (String(id) === USER_A ? { _id: USER_A, role: 'seller', email: 'seller@example.com', notificationPrefs: { emailNewOrder: true, emailLowStock: true } } : null));
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
  AlertModel.create = async (doc: Record<string, any>) => {
    if (alerts.some((a) => a.open && a.store === doc.store && a.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    alerts.push(row);
    return row;
  };
  SettingsModel.findOne = () => lean(() => ({ supportEmail }));
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  delete process.env.EMAIL_PROVIDER;
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.contact)) ContactModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.outbox)) OutboxModel[m] = fn;
    UserModel.findById = saved.user;
    AuditModel.create = saved.audit;
    AlertModel.create = saved.alert;
    SettingsModel.findOne = saved.settings;
    delete process.env.APP_BASE_URL_SELLER;
  };
});

afterEach(() => restore());

const params = (values: Record<string, string>): Ctx => ({ params: Promise.resolve(values) });
const post = (path: string, body: unknown, raw?: string) =>
  new NextRequest('http://seller.test/api/storefront/v1/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
const sendStore = (storeId: string, body: unknown, raw?: string) => storeContact(post('stores/' + storeId + '/contact', body, raw), params({ id: storeId }));
const sendPlatform = (body: unknown, raw?: string) => platformContact(post('contact', body, raw));
const good = { name: 'Sara Khan', email: 'sara@example.com', message: 'Do you deliver to Quetta?', consent: true };
type Body = Record<string, any>;

// ----------------------------------------------------------------------------------------------------------------------------- store form

test('a good store message is stored (scope store, this store, status new, revision 0) and ONLY THEN answered', async () => {
  const res = await sendStore(STORE_A, good);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { data: { received: true } });
  assert.equal(creates, 1);
  const stored = messages.at(-1)!;
  assert.equal(stored.scope, 'store');
  assert.equal(String(stored.store), STORE_A);
  assert.equal(stored.status, 'new');
  assert.equal(stored.revision, 0);
  assert.equal(stored.consent, true);
  assert.equal(stored.email, 'sara@example.com');
  assert.equal(stored.phone, null);
});

test('a phone alone is enough, and the number is kept as typed', async () => {
  assert.equal((await sendStore(STORE_A, { name: 'Ali', phone: '+92 300 1234567', message: 'Is it in stock?', consent: true })).status, 201);
  assert.equal(messages.at(-1)!.phone, '+92 300 1234567');
  assert.equal(messages.at(-1)!.email, '');
});

test('if the message cannot be stored the answer is NOT a success (503), and nothing was kept', async () => {
  failCreate = true;
  const res = await sendStore(STORE_A, good);
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as Body).error.code, 'STOREFRONT_UNAVAILABLE');
  assert.equal(messages.length, 4);
});

test('the HONEYPOT: a filled hidden field is answered like a success and stores NOTHING (no message, no alert, no email)', async () => {
  const res = await sendStore(STORE_A, { ...good, website: 'http://spam.test' });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { data: { received: true } });
  assert.equal(creates, 0);
  assert.equal(messages.length, 4);
  assert.equal(alerts.length, 0);
  assert.equal(outbox.length, 0);
  // An empty or blank honeypot is a person.
  assert.equal((await sendStore(STORE_A, { ...good, website: '' })).status, 201);
  assert.equal((await sendStore(STORE_A, { ...good, website: '   ' })).status, 201);
  assert.equal(creates, 2);
});

test('a bad form is 400 INVALID_REQUEST naming the field, and stores nothing', async () => {
  const cases: Array<[unknown, string]> = [
    [{ ...good, email: 'not-an-email' }, 'email'],
    [{ ...good, email: 'a@b.c'.padEnd(201, 'x') + '.com' }, 'email'],
    [{ ...good, message: 'x'.repeat(3001) }, 'message'],
    [{ ...good, message: 'hi' }, 'message'],
    [{ ...good, message: undefined }, 'message'],
    [{ ...good, name: '' }, 'name'],
    [{ ...good, name: 'x'.repeat(101) }, 'name'],
    [{ ...good, phone: 'call me maybe' }, 'phone'],
    [{ ...good, phone: '1'.repeat(31) }, 'phone'],
    [{ ...good, consent: false }, 'consent'],
    [{ name: 'Sara', message: 'Hello there', consent: true }, 'email'],
    [{ ...good, store: STORE_B }, 'store'],
    [{ ...good, status: 'closed' }, 'status'],
    [{ ...good, revision: 4 }, 'revision'],
  ];
  for (const [body, field] of cases) {
    resetRateLimits();
    const res = await sendStore(STORE_A, body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    const out = (await res.json()) as Body;
    assert.equal(out.error.code, 'INVALID_REQUEST');
    assert.equal(out.field, field, JSON.stringify(body).slice(0, 80));
  }
  resetRateLimits();
  assert.equal((await sendStore(STORE_A, null, 'not json')).status, 400);
  resetRateLimits();
  assert.equal((await sendStore(STORE_A, null, JSON.stringify({ ...good, message: 'x'.repeat(40000) }))).status, 400, 'an oversize body is refused before it is parsed');
  assert.equal(creates, 0);
});

test('an unknown, a malformed or a not-live store is refused and stores nothing; a seller\'s other store is not reachable by the body', async () => {
  assert.equal((await sendStore(oid(999), good)).status, 404);
  assert.equal((await sendStore('not-an-id', good)).status, 404);
  const pending = await sendStore(STORE_PENDING, good);
  assert.equal(pending.status, 403);
  assert.equal(((await pending.json()) as Body).error.code, 'STORE_NOT_ACTIVE');
  assert.equal(creates, 0);
});

test('a FLOOD is stopped: the sixth message of ten minutes from one address is 429 RATE_LIMITED with Retry-After, and a flood on one store does not block another', async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await sendStore(STORE_A, good)).status, 201, 'message ' + (i + 1));
  const sixth = await sendStore(STORE_A, good);
  assert.equal(sixth.status, 429);
  assert.equal(((await sixth.json()) as Body).error.code, 'RATE_LIMITED');
  assert.ok(Number(sixth.headers.get('retry-after')) >= 1);
  assert.equal(creates, 5, 'the refused message was not stored');
  assert.equal((await sendStore(STORE_B, good)).status, 201, 'another store has its own counter');
  assert.equal((await sendPlatform({ name: 'V', email: 'v@example.com', message: 'Hello platform', consent: true })).status, 201, 'and so does the platform form');
});

test('the limiter runs before the database: a flood of invalid bodies is limited too', async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await sendStore(STORE_A, { nope: true })).status, 400);
  assert.equal((await sendStore(STORE_A, { nope: true })).status, 429);
});

// -------------------------------------------------------------------------------------------------------------------------- platform form

test('the platform form stores a PLATFORM message (no store) and answers only after it is stored', async () => {
  const res = await sendPlatform({ name: 'Visitor', email: 'visitor@example.com', message: 'I want a demo please', consent: true });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { data: { received: true } });
  const stored = messages.at(-1)!;
  assert.equal(stored.scope, 'platform');
  assert.equal(stored.store, null);
  assert.equal(stored.email, 'visitor@example.com');
  assert.equal(stored.status, 'new');
});

test('the platform form NEVER answers success without having stored the message', async () => {
  failCreate = true;
  const res = await sendPlatform({ name: 'Visitor', email: 'visitor@example.com', message: 'I want a demo please', consent: true });
  assert.equal(res.status, 503);
  assert.notEqual(res.status, 200);
  assert.notEqual(res.status, 201);
  assert.equal(messages.length, 4);
});

test('the platform form: honeypot answers success and stores nothing; a bad body is a 400 with its field; an email is required', async () => {
  assert.equal((await sendPlatform({ name: 'Bot', email: 'bot@example.com', message: 'Buy now cheap', consent: true, website: 'x' })).status, 201);
  assert.equal(creates, 0);
  const cases: Array<[unknown, string]> = [
    [{ name: 'V', message: 'Hello platform', consent: true }, 'email'],
    [{ name: 'V', email: 'bad', message: 'Hello platform', consent: true }, 'email'],
    [{ name: 'V', email: 'v@example.com', message: 'x'.repeat(3001), consent: true }, 'message'],
    [{ name: 'V', email: 'v@example.com', message: 'Hello platform', consent: false }, 'consent'],
    [{ name: 'V', email: 'v@example.com', message: 'Hello platform', consent: true, phone: '0300' }, 'phone'],
  ];
  for (const [body, field] of cases) {
    resetRateLimits();
    const res = await sendPlatform(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(((await res.json()) as Body).field, field);
  }
  assert.equal(creates, 0);
});

test('the platform form is limited like the store form (5 per ten minutes per address)', async () => {
  const body = { name: 'V', email: 'v@example.com', message: 'Hello platform', consent: true };
  for (let i = 0; i < 5; i += 1) assert.equal((await sendPlatform(body)).status, 201);
  assert.equal((await sendPlatform(body)).status, 429);
});

test('a platform message is queued to the support address of the platform settings, once; with no address it stays in the admin inbox', async () => {
  const contact = { id: oid(777), name: 'Visitor', email: 'visitor@example.com', phone: null, message: 'I want a <b>demo</b>' };
  await sendPlatformContactNotice(contact);
  await sendPlatformContactNotice(contact);
  const mails = outbox.filter((row) => row.template === 'contact_message_platform');
  assert.equal(mails.length, 1);
  assert.equal(mails[0]!.to, 'support@markazify.com');
  assert.equal(String(mails[0]!.bodyHtml).includes('<b>demo</b>'), false, 'what the visitor typed is escaped');
  outbox = [];
  supportEmail = null;
  await sendPlatformContactNotice({ ...contact, id: oid(778) });
  assert.equal(outbox.length, 0);
});

// ------------------------------------------------------------------------------------------------------------------------- the bell alert

test('a new store message raises ONE contact_message bell alert (all four places agree) and one email to the seller, once per message', async () => {
  const contact = { id: MSG_A, name: 'Sara Khan', email: 'sara@example.com', phone: null, message: 'Do you deliver to <i>Quetta</i>?' };
  await sendStoreContactNotices(STORE_A, contact);
  await sendStoreContactNotices(STORE_A, contact);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, 'contact_message');
  assert.equal(alerts[0]!.dedupeKey, 'contact:' + MSG_A);
  assert.equal(alerts[0]!.link, '/inbox');
  assert.match(alerts[0]!.title, /Sara Khan/);
  const mails = outbox.filter((row) => row.template === 'contact_message_store');
  assert.equal(mails.length, 1);
  assert.equal(mails[0]!.to, 'seller@example.com');
  assert.equal(String(mails[0]!.bodyHtml).includes('<i>Quetta</i>'), false);
  assert.ok(String(mails[0]!.bodyHtml).includes('/inbox'), 'the email links to the inbox');
});

test('a seller who switched email off still gets the bell alert and no email', async () => {
  UserModel.findById = () => lean(() => ({ _id: USER_A, role: 'seller', email: 'seller@example.com', notificationPrefs: { emailNewOrder: false, emailLowStock: true } }));
  await sendStoreContactNotices(STORE_A, { id: MSG_A, name: 'Sara', email: '', phone: '0300 1234567', message: 'Hello' });
  assert.equal(alerts.length, 1);
  assert.equal(outbox.filter((row) => row.template === 'contact_message_store').length, 0);
});

// ------------------------------------------------------------------------------------------------------------------------------ the inbox

const authed = (method: string, path: string, opts: { token?: string | null; store?: string | null; body?: unknown; raw?: string } = {}) => {
  const { token = tokenA, store = STORE_A, body, raw } = opts;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = 'Bearer ' + token;
  if (store !== null) headers['x-store-id'] = store;
  return new NextRequest('http://seller.test/api/contactMessages' + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
};
const list = (query = '', opts: Parameters<typeof authed>[2] = {}) => inbox.GET(authed('GET', query, opts));
const one = (id: string, opts: Parameters<typeof authed>[2] = {}) => inboxItem.GET(authed('GET', '/' + id, opts), params({ id }));
const patch = (id: string, body: unknown, opts: Parameters<typeof authed>[2] = {}) => inboxItem.PATCH(authed('PATCH', '/' + id, { ...opts, body }), params({ id }));
const reply = (id: string, body: unknown, opts: Parameters<typeof authed>[2] = {}) => inboxReply.POST(authed('POST', '/' + id + '/reply', { ...opts, body }), params({ id }));
const row = (id: string): Record<string, any> => messages.find((r) => r._id === id)!;

test('the inbox lists the store\'s own messages, newest first: never another store\'s, never a platform message', async () => {
  const res = await list();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.deepEqual(body.docs.map((d: Body) => d.id), [MSG_A_PHONE, MSG_A]);
  const text = JSON.stringify(body);
  for (const leak of ['secret of store B', 'platform only', 'Bilal customer']) assert.equal(text.includes(leak), false, leak);
  const theirs = (await (await list('', { token: tokenB, store: STORE_B })).json()) as Body;
  assert.deepEqual(theirs.docs.map((d: Body) => d.id), [MSG_B]);
});

test('the status filter and the unread count (status=new&limit=1, totalDocs)', async () => {
  row(MSG_A).status = 'read';
  const unread = (await (await list('?status=new&limit=1')).json()) as Body;
  assert.equal(unread.totalDocs, 1);
  assert.equal(unread.docs.length, 1);
  assert.deepEqual(((await (await list('?status=read')).json()) as Body).docs.map((d: Body) => d.id), [MSG_A]);
  assert.equal((await list('?status=nonsense')).status, 422);
});

test('inbox access: no session 401, an admin 403, another seller\'s store 403', async () => {
  assert.equal((await list('', { token: null })).status, 401);
  assert.equal((await list('', { token: tokenAdmin })).status, 403);
  assert.equal((await list('', { token: tokenB, store: STORE_A })).status, 403);
  assert.equal((await one(MSG_A, { token: tokenB, store: STORE_A })).status, 403);
});

test('a message of another store, and a platform message, answer 404 on detail, mark read and reply: their contents are never returned and nothing changes', async () => {
  for (const id of [MSG_B, MSG_PLATFORM, oid(999)]) {
    const detail = await one(id);
    assert.equal(detail.status, 404, id);
    const text = await detail.text();
    assert.equal(text.includes('secret of store B'), false);
    assert.equal(text.includes('platform only'), false);
    assert.equal((await patch(id, { revision: 0, status: 'read' })).status, 404, 'patch ' + id);
    assert.equal((await reply(id, { revision: 0, text: 'Hello there' })).status, 404, 'reply ' + id);
  }
  assert.equal((await one('not-an-id')).status, 404);
  assert.equal(updates.length, 0);
  assert.equal(row(MSG_B).status, 'new');
  // And Seller B cannot reach store A's message under B's own store.
  assert.equal((await one(MSG_A, { token: tokenB, store: STORE_B })).status, 404);
  assert.equal((await patch(MSG_A, { revision: 0, status: 'closed' }, { token: tokenB, store: STORE_B })).status, 404);
  assert.equal((await reply(MSG_A, { revision: 0, text: 'Hijack' }, { token: tokenB, store: STORE_B })).status, 404);
  assert.equal(row(MSG_A).status, 'new');
});

test('detail returns the message with a wa.me link only when there is no email', async () => {
  const withEmail = (await (await one(MSG_A)).json()) as Body;
  assert.equal(withEmail.message, 'Do you deliver to Quetta?');
  assert.equal(withEmail.waLink, null);
  const phoneOnly = (await (await one(MSG_A_PHONE)).json()) as Body;
  assert.equal(phoneOnly.waLink, 'https://wa.me/923001234567');
  assert.equal(whatsappLink('+92 300 1234567'), 'https://wa.me/923001234567');
  assert.equal(whatsappLink('0300-1234567', 'Hi there'), 'https://wa.me/923001234567?text=Hi%20there');
  assert.equal(whatsappLink('12'), null);
  assert.equal(whatsappLink(null), null);
});

test('mark read: ONE compare-and-set on the revision, audited; marking read again is a no-op; a stale revision is 409 CONTACT_REVISION_CONFLICT', async () => {
  const res = await patch(MSG_A, { revision: 0, status: 'read' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.status, 'read');
  assert.equal(body.revision, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]!.filter, { _id: MSG_A, scope: 'store', store: STORE_A, revision: { $in: [0, null] } });
  assert.deepEqual(updates[0]!.update, { $set: { status: 'read' }, $inc: { revision: 1 } });
  assert.equal(audits.at(-1)!.action, 'contact.read');
  assert.equal((await patch(MSG_A, { revision: 1, status: 'read' })).status, 200);
  assert.equal(updates.length, 1, 'already read: no write');
  const stale = await patch(MSG_A, { revision: 0, status: 'closed' });
  assert.equal(stale.status, 409);
  const conflict = (await stale.json()) as Body;
  assert.equal(conflict.code, 'CONTACT_REVISION_CONFLICT');
  assert.equal(conflict.currentRevision, 1);
  assert.equal(row(MSG_A).status, 'read');
  assert.equal((await patch(MSG_A, { revision: 1, status: 'closed' })).status, 200);
  assert.equal(row(MSG_A).status, 'closed');
  assert.equal(audits.at(-1)!.action, 'contact.closed');
});

test('a message that was replied to is not moved back to read', async () => {
  row(MSG_A).status = 'replied';
  assert.equal((await patch(MSG_A, { revision: 0, status: 'read' })).status, 200);
  assert.equal(row(MSG_A).status, 'replied');
  assert.equal(updates.length, 0);
});

test('mark read and close refuse a bad body with 400 CONTACT_INVALID and the field', async () => {
  const cases: Array<[unknown, string]> = [
    [{ status: 'read' }, 'revision'],
    [{ revision: 0 }, 'status'],
    [{ revision: 0, status: 'replied' }, 'status'],
    [{ revision: -1, status: 'read' }, 'revision'],
    [{ revision: 0, status: 'read', message: 'edited' }, 'message'],
    [{ revision: 0, status: 'read', store: STORE_B }, 'store'],
  ];
  for (const [body, field] of cases) {
    const res = await patch(MSG_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'CONTACT_INVALID');
    assert.equal(out.field, field);
  }
  assert.equal(updates.length, 0);
  assert.equal((await patch(MSG_A, { revision: 0, status: 'read' }, { token: tokenAdmin })).status, 403);
  assert.equal((await patch(MSG_A, { revision: 0, status: 'read' }, { token: null })).status, 401);
});

test('reply by EMAIL when the shopper gave one: the reply is kept, the status is replied, the answer says email, and the email text is escaped', async () => {
  const res = await reply(MSG_A, { revision: 0, text: 'Yes, we deliver to <b>Quetta</b>.' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.channel, 'email');
  assert.equal(body.whatsappLink, null);
  assert.equal(body.message.status, 'replied');
  assert.equal(body.message.revision, 1);
  assert.equal(body.message.replies[0].channel, 'email');
  assert.equal(body.message.replies[0].by, USER_A);
  assert.equal(body.message.replies[0].text, 'Yes, we deliver to <b>Quetta</b>.', 'stored as typed; escaped on output');
  assert.equal(audits.at(-1)!.action, 'contact.reply');
  await sendContactReply(STORE_A, { id: MSG_A, name: 'Sara Khan', email: 'sara@example.com' }, 'Yes, we deliver to <b>Quetta</b>.', 1);
  const mail = outbox.find((r) => r.template === 'contact_reply')!;
  assert.equal(mail.to, 'sara@example.com');
  assert.equal(String(mail.bodyHtml).includes('<b>Quetta</b>'), false);
  assert.ok(String(mail.bodyHtml).includes('&lt;b&gt;Quetta&lt;/b&gt;'));
});

test('reply WITHOUT an email: the answer carries a wa.me link to the phone with the reply as the text, and the reply is recorded on the whatsapp channel; no email is queued', async () => {
  const res = await reply(MSG_A_PHONE, { revision: 0, text: 'Yes we do.' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.channel, 'whatsapp');
  assert.equal(body.whatsappLink, 'https://wa.me/923001234567?text=Yes%20we%20do.');
  assert.equal(body.message.replies[0].channel, 'whatsapp');
  assert.equal(outbox.filter((r) => r.template === 'contact_reply').length, 0);
  // A message with neither an email nor a usable phone cannot be answered.
  row(MSG_A_PHONE).status = 'new';
  row(MSG_A_PHONE).phone = null;
  const none = await reply(MSG_A_PHONE, { revision: 1, text: 'Hello?' });
  assert.equal(none.status, 409);
  assert.equal(((await none.json()) as Body).code, 'CONTACT_NO_ADDRESS');
});

test('reply: a stale revision is 409 and writes nothing; a closed message is 409 CONTACT_CLOSED; a bad body is 400 with its field', async () => {
  assert.equal((await reply(MSG_A, { revision: 0, text: 'First' })).status, 200);
  const stale = await reply(MSG_A, { revision: 0, text: 'Second' });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as Body).code, 'CONTACT_REVISION_CONFLICT');
  assert.equal(row(MSG_A).replies.length, 1);
  row(MSG_A).status = 'closed';
  const closed = await reply(MSG_A, { revision: 1, text: 'Third' });
  assert.equal(closed.status, 409);
  assert.equal(((await closed.json()) as Body).code, 'CONTACT_CLOSED');
  const cases: Array<[unknown, string]> = [
    [{ revision: 0 }, 'text'],
    [{ revision: 0, text: '' }, 'text'],
    [{ revision: 0, text: '   ' }, 'text'],
    [{ revision: 0, text: 'x'.repeat(3001) }, 'text'],
    [{ text: 'No revision' }, 'revision'],
    [{ revision: 0, text: 'Hi', channel: 'email' }, 'channel'],
  ];
  for (const [body, field] of cases) {
    const res = await reply(MSG_A_PHONE, body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(((await res.json()) as Body).field, field);
  }
  assert.equal((await reply(MSG_A_PHONE, { revision: 0, text: 'Hi' }, { token: tokenAdmin })).status, 403);
  assert.equal((await reply(MSG_A_PHONE, { revision: 0, text: 'Hi' }, { token: null })).status, 401);
});

test('the wire form is plain data: it never HTML-processes what a shopper typed', () => {
  const wire = contactToWire({ _id: 'x', scope: 'store', name: '<script>alert(1)</script>', email: 'a@b.co', message: '<img src=x onerror=alert(1)>', status: 'new', replies: [{ text: '<b>r</b>', at: T0, by: 'u', channel: 'email' }], createdAt: T0 });
  assert.equal(wire.name, '<script>alert(1)</script>');
  assert.equal(wire.message, '<img src=x onerror=alert(1)>');
  assert.equal((wire.replies as Array<Record<string, unknown>>)[0]!.text, '<b>r</b>');
  assert.equal(wire.revision, 0);
});
