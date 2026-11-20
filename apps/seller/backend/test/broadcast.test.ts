import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Broadcast, EmailUnsubscribe, NotificationOutbox, Order, SellerAlert, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { sendOrderPlaced, sendOrderStatus } from '@/lib/notifications';
import { signUnsubscribe, verifyUnsubscribe } from '@/lib/broadcast';
import { installCustomersWorld, makeOrder, type CustomersWorld } from './helpers/customers-world';

// Sprint 4 EP-07.US04 (D-092): customers, broadcasts and the unsubscribe link. Every model is stubbed in memory (no database,
// no email leaves: a broadcast writes outbox rows and sends none). The stubs enforce the two unique indexes the code relies
// on: { store, dayKey } of broadcasts and { store, email } of unsubscribes, and the outbox dedupeKey.

const SECRET = 'x'.repeat(40);
const SIGNING = 'u'.repeat(32);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const USER_C = '65a000000000000000000004';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const STORE_C = '65a000000000000000000013';

const OrderModel = Order as any;
const OutboxModel = NotificationOutbox as any;
const BroadcastModel = Broadcast as any;
const UnsubModel = EmailUnsubscribe as any;
const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;
const AlertModel = SellerAlert as any;

type Row = Record<string, any>;
type Ctx = { params: Promise<{ id: string }> };

let orders: Row[] = [];
let unsubs: Row[] = [];
let broadcasts: Row[] = [];
let outbox: Row[] = [];
let audits: Row[] = [];
let stores: Record<string, Row> = {};
let users: Record<string, Row> = {};
let pipelines: Row[][] = [];
let unsubWrites = 0;
let tokenA = '';
let tokenB = '';
let tokenC = '';
let tokenAdmin = '';
let restore: () => void = () => {};
let customersGET: (r: NextRequest, c: Ctx) => Promise<Response>;
let broadcastGET: (r: NextRequest, c: Ctx) => Promise<Response>;
let broadcastPOST: (r: NextRequest, c: Ctx) => Promise<Response>;
let previewPOST: (r: NextRequest, c: Ctx) => Promise<Response>;
let unsubscribePOST: (r: NextRequest) => Promise<Response>;

const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const yieldOnce = () => new Promise<void>((resolve) => setImmediate(resolve));
const T0 = new Date('2026-11-14T10:00:00Z');

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenC = await signSession({ sub: USER_C, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  customersGET = (await import('../src/app/api/stores/[id]/customers/route')).GET;
  broadcastGET = (await import('../src/app/api/stores/[id]/broadcast/route')).GET;
  broadcastPOST = (await import('../src/app/api/stores/[id]/broadcast/route')).POST;
  previewPOST = (await import('../src/app/api/stores/[id]/broadcast/preview/route')).POST;
  unsubscribePOST = (await import('../src/app/api/unsubscribe/route')).POST;
});

function chain(read: () => unknown) {
  let skipped = 0;
  let limited: number | null = null;
  const q: any = {
    select: () => q,
    sort: () => q,
    skip: (n: number) => {
      skipped = n;
      return q;
    },
    limit: (n: number) => {
      limited = n;
      return q;
    },
    lean: async () => {
      const value = read();
      return Array.isArray(value) ? value.slice(skipped, limited === null ? undefined : skipped + limited) : value;
    },
  };
  return q;
}

// Sprint 5 EP-10: Order.aggregate, CustomerNote.find and EmailUnsubscribe.find are stubbed by ./helpers/customers-world (the customers
// module groups by the normalized phone first; the broadcast recipients are the distinct emails).
let world: CustomersWorld;

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    order: OrderModel.aggregate,
    outbox: Object.fromEntries(['create', 'findOne', 'find', 'findOneAndUpdate'].map((m) => [m, OutboxModel[m]])),
    broadcast: Object.fromEntries(['create', 'find', 'countDocuments'].map((m) => [m, BroadcastModel[m]])),
    unsub: Object.fromEntries(['find', 'updateOne'].map((m) => [m, UnsubModel[m]])),
    store: Object.fromEntries(['findOne', 'exists', 'findById'].map((m) => [m, StoreModel[m]])),
    user: UserModel.findById,
    audit: AuditModel.create,
    alert: AlertModel.create,
    env: Object.fromEntries(['UNSUBSCRIBE_SIGNING_SECRET', 'APP_BASE_URL_SELLER', 'STOREFRONT_URL', 'EMAIL_PROVIDER'].map((k) => [k, process.env[k]])),
  };
  world = installCustomersWorld();
  orders = world.orders;
  unsubs = world.unsubs;
  pipelines = world.pipelines;
  broadcasts = [];
  outbox = [];
  audits = [];
  unsubWrites = 0;
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, name: 'Zara Lawn', slug: 'zara', storefront: {} },
    [STORE_B]: { _id: STORE_B, owner: USER_B, name: 'Bilal Shoes', slug: 'bilal', storefront: {} },
    [STORE_C]: { _id: STORE_C, owner: USER_C, name: 'Cara Cloth', slug: 'cara', storefront: {} },
  };
  users = {
    [USER_A]: { _id: USER_A, role: 'seller', email: 'a@seller.test', emailVerifiedAt: T0, notificationPrefs: { emailNewOrder: true, emailLowStock: true } },
    [USER_B]: { _id: USER_B, role: 'seller', email: 'b@seller.test', emailVerifiedAt: T0 },
    [USER_C]: { _id: USER_C, role: 'seller', email: 'c@seller.test', emailVerifiedAt: null },
    [ADMIN]: { _id: ADMIN, role: 'admin', email: 'admin@markazify.test', emailVerifiedAt: T0 },
  };
  process.env.UNSUBSCRIBE_SIGNING_SECRET = SIGNING;
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  process.env.STOREFRONT_URL = 'https://markazify.com';
  delete process.env.EMAIL_PROVIDER;

  (mongoose as any).connect = async () => mongoose;
  OutboxModel.create = async (doc: Row) => {
    if (doc.dedupeKey !== undefined && outbox.some((r) => r.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    outbox.push(row);
    return row;
  };
  OutboxModel.findOne = (filter: Row) => chain(() => outbox.find((r) => r.dedupeKey === filter.dedupeKey) ?? null);
  OutboxModel.find = (filter: Row) => chain(() => outbox.filter((r) => typeof r.dedupeKey === 'string' && new RegExp(filter.dedupeKey.$regex).test(r.dedupeKey)));
  // Nothing is claimed, so no provider is ever asked to send.
  OutboxModel.findOneAndUpdate = () => chain(() => null);
  BroadcastModel.create = async (doc: Row) => {
    // The unique index { store, dayKey }: checked and written in one synchronous step, like the database does.
    if (broadcasts.some((b) => String(b.store) === String(doc.store) && b.dayKey === doc.dayKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...doc };
    broadcasts.push(row);
    await yieldOnce();
    return row;
  };
  BroadcastModel.find = (filter: Row) => chain(() => broadcasts.filter((b) => String(b.store) === String(filter.store)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  BroadcastModel.countDocuments = async (filter: Row) => broadcasts.filter((b) => String(b.store) === String(filter.store)).length;
  UnsubModel.updateOne = async (filter: Row, update: Row) => {
    unsubWrites += 1;
    if (unsubs.some((u) => String(u.store) === String(filter.store) && u.email === filter.email)) return { matchedCount: 1 };
    unsubs.push({ store: String(filter.store), email: filter.email, at: update.$setOnInsert.at });
    return { upsertedCount: 1 };
  };
  StoreModel.findOne = (filter: Row) =>
    chain(() => {
      const row = stores[String(filter._id)];
      return row && (filter.owner === undefined || String(row.owner) === String(filter.owner)) ? structuredClone(row) : null;
    });
  StoreModel.exists = async (filter: Row) => (stores[String(filter._id)] && String(stores[String(filter._id)]!.owner) === String(filter.owner) ? { _id: filter._id } : null);
  StoreModel.findById = (id: unknown) => chain(() => (stores[String(id)] ? structuredClone(stores[String(id)]) : null));
  UserModel.findById = (id: unknown) => chain(() => users[String(id)] ?? null);
  AuditModel.create = async (doc: Row) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  AlertModel.create = async (doc: Row) => ({ _id: new mongoose.Types.ObjectId(), ...doc });

  restore = () => {
    (mongoose as any).connect = saved.connect;
    world.restore();
    OrderModel.aggregate = saved.order;
    for (const [m, fn] of Object.entries(saved.outbox)) OutboxModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.broadcast)) BroadcastModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.unsub)) UnsubModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    UserModel.findById = saved.user;
    AuditModel.create = saved.audit;
    AlertModel.create = saved.alert;
    for (const [key, value] of Object.entries(saved.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value as string;
    }
  };
});

afterEach(() => restore());

// ------------------------------------------------------------------------------------------------------------ helpers

function sell(store: string, customerEmail: string | null, extra: Row = {}): void {
  orders.push(makeOrder(store, { customerEmail, ...extra }));
}

function crowd(store: string, count: number, prefix = 'c'): void {
  for (let i = 0; i < count; i += 1) sell(store, prefix + i + '@example.com');
}

const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const authed = (token: string) => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
const url = (id: string, tail: string) => 'http://seller.test/api/stores/' + id + tail;
const getCustomers = (id: string, token: string, query = '') => customersGET(new NextRequest(url(id, '/customers' + query), { headers: authed(token) }), ctx(id));
const getHistory = (id: string, token: string) => broadcastGET(new NextRequest(url(id, '/broadcast'), { headers: authed(token) }), ctx(id));
const preview = (id: string, token: string, body: unknown = { subject: 'Eid sale', message: 'Everything is 20% off.' }) =>
  previewPOST(new NextRequest(url(id, '/broadcast/preview'), { method: 'POST', headers: authed(token), body: JSON.stringify(body) }), ctx(id));
const send = (id: string, token: string, body: unknown) =>
  broadcastPOST(new NextRequest(url(id, '/broadcast'), { method: 'POST', headers: authed(token), body: JSON.stringify(body) }), ctx(id));
const draft = (expectedCount: number, extra: Row = {}) => ({ subject: 'Eid sale', message: 'Everything is 20% off.', expectedCount, ...extra });
const json = async (res: Response) => (await res.json()) as Row;
const sellerLink = (path: string) => 'https://seller.markazify.com' + path;

const unsubscribe = (store: string, email: string, sig: string) =>
  unsubscribePOST(new NextRequest('http://seller.test/api/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ store, email, sig }) }));

// --------------------------------------------------------------------------------------------- recipients and customers

test('the preview counts customers with an email who did not unsubscribe, once each, and only this store', async () => {
  sell(STORE_A, 'ayesha@example.com');
  sell(STORE_A, 'AYESHA@example.com ');
  sell(STORE_A, 'bilal@example.com');
  sell(STORE_A, 'gone@example.com');
  sell(STORE_A, null, { phone: '+923001234567' });
  sell(STORE_A, '', { phone: '+923007654321' });
  sell(STORE_B, 'other-seller@example.com');
  unsubs.push({ store: STORE_A, email: 'gone@example.com', at: T0 });
  unsubs.push({ store: STORE_B, email: 'ayesha@example.com', at: T0 });

  const res = await preview(STORE_A, tokenA);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { recipientCount: 2, cap: 500, tooLarge: false });
  for (const pipeline of pipelines) assert.equal(String(pipeline[0]!.$match.store), STORE_A, 'every read is scoped to the verified store');
});

test('the customers list shows name, email, phone, order count, last order and the unsubscribed flag of THIS store only', async () => {
  sell(STORE_A, 'ayesha@example.com', { customerName: 'Ayesha', phone: '+923001234567' });
  sell(STORE_A, 'ayesha@example.com', { customerName: 'Ayesha K', phone: '+923001234567' });
  sell(STORE_A, 'gone@example.com', { customerName: 'Gone' });
  sell(STORE_A, null, { customerName: 'Walk In', phone: '+923007654321' });
  sell(STORE_B, 'other-seller@example.com');
  unsubs.push({ store: STORE_A, email: 'gone@example.com', at: T0 });

  const body = await json(await getCustomers(STORE_A, tokenA));
  assert.equal(body.totalDocs, 3);
  const byName = Object.fromEntries((body.docs as Row[]).map((c) => [c.name, c]));
  assert.equal(byName['Ayesha K'].orderCount, 2);
  assert.equal(byName['Ayesha K'].email, 'ayesha@example.com');
  assert.equal(byName['Ayesha K'].unsubscribed, false);
  assert.equal(byName['Gone'].unsubscribed, true);
  assert.equal(byName['Walk In'].email, null);
  assert.equal(JSON.stringify(body).includes('other-seller'), false);

  const withPhone = await json(await getCustomers(STORE_A, tokenA, '?phone=1'));
  assert.deepEqual((withPhone.docs as Row[]).map((c) => c.name).sort(), ['Ayesha K', 'Walk In']);
});

test('Sprint 5 EP-10.US01: the broadcast counts did not change for email-only data, and the same data lists the same customers', async () => {
  // Email-only history, exactly the Sprint 4 shape: two shoppers, one of them twice, one unsubscribed.
  sell(STORE_A, 'ayesha@example.com');
  sell(STORE_A, 'AYESHA@example.com ');
  sell(STORE_A, 'bilal@example.com');
  sell(STORE_A, 'gone@example.com');
  unsubs.push({ store: STORE_A, email: 'gone@example.com', at: T0 });
  assert.deepEqual(await json(await preview(STORE_A, tokenA)), { recipientCount: 2, cap: 500, tooLarge: false });
  const list = await json(await getCustomers(STORE_A, tokenA));
  assert.equal(list.totalDocs, 3, 'ayesha (twice), bilal and gone are three customers, as before');
  assert.deepEqual((list.docs as Row[]).map((c) => c.id).sort(), ['ayesha@example.com', 'bilal@example.com', 'gone@example.com']);
});

test('Sprint 5 EP-10.US01: one shopper with and without an email is ONE customer, while the broadcast still counts each address once', async () => {
  sell(STORE_A, 'ayesha@example.com', { phone: '0300 1234567', customerName: 'Ayesha' });
  sell(STORE_A, null, { phone: '+92 300 1234567', customerName: 'Ayesha K' });
  sell(STORE_A, 'ayesha.work@example.com', { phone: '3001234567' });
  const list = await json(await getCustomers(STORE_A, tokenA));
  assert.equal(list.totalDocs, 1, 'three spellings of one phone are one customer');
  const [customer] = list.docs as Row[];
  assert.equal(customer.id, '+923001234567');
  assert.equal(customer.orderCount, 3);
  assert.equal(customer.email, 'ayesha.work@example.com', 'the newest email of the customer');
  assert.deepEqual(await json(await preview(STORE_A, tokenA)), { recipientCount: 2, cap: 500, tooLarge: false });
});

test('a bad customers query is a 400 that names the field', async () => {
  const res = await getCustomers(STORE_A, tokenA, '?limit=500');
  assert.equal(res.status, 400);
  assert.equal((await json(res)).field, 'limit');
  assert.equal((await json(await getCustomers(STORE_A, tokenA, '?storeId=x'))).field, 'storeId');
});

// ----------------------------------------------------------------------------------------------------- the 500 cap

test('more than 500 recipients: the preview says so and shows at most 500, and the send is refused with 422', async () => {
  crowd(STORE_A, 501);
  const body = await json(await preview(STORE_A, tokenA));
  assert.deepEqual(body, { recipientCount: 500, cap: 500, tooLarge: true });

  const res = await send(STORE_A, tokenA, draft(500));
  assert.equal(res.status, 422);
  assert.equal((await json(res)).code, 'BROADCAST_TOO_LARGE');
  assert.equal(broadcasts.length, 0);
  assert.equal(outbox.length, 0);
});

test('exactly 500 recipients are queued in the outbox without sending, each with its own key and a signed unsubscribe link', async () => {
  crowd(STORE_A, 500);
  const res = await send(STORE_A, tokenA, draft(500));
  assert.equal(res.status, 201);
  const body = await json(res);
  assert.equal(body.recipientCount, 500);
  assert.deepEqual(body.counts, { queued: 500, sent: 0, failed: 0, skipped: 0 });
  assert.equal(broadcasts.length, 1);
  assert.equal(outbox.length, 500);
  assert.ok(outbox.every((row) => row.template === 'broadcast' && row.status === 'queued' && row.attempts === 0));
  assert.ok(outbox.every((row) => row.dedupeKey === 'broadcast:' + body.id + ':' + row.to));
  assert.equal(new Set(outbox.map((row) => row.to)).size, 500);

  const audit = audits.find((a) => a.action === 'broadcast.create');
  assert.ok(audit, 'the creation is audited');
  assert.equal(JSON.stringify(audit).includes('@'), false, 'no email address in the audit entry');
  assert.equal(JSON.stringify(audit).includes('Everything is 20%'), false, 'not the message either');

  const mail = outbox[0]!;
  const link = /https:\/\/seller\.markazify\.com\/unsubscribe\?s=([0-9a-f]{24})&e=([^&\s]+)&t=([0-9a-f]{64})/.exec(mail.bodyText);
  assert.ok(link, 'the email carries the unsubscribe link');
  assert.equal(link[1], STORE_A);
  assert.equal(decodeURIComponent(link[2]!), mail.to);
  assert.equal(verifyUnsubscribe(STORE_A, mail.to, link[3]!, SIGNING), true);
  assert.equal((await unsubscribe(link[1]!, decodeURIComponent(link[2]!), link[3]!)).status, 200, 'the link in the email works');
});

test('the history counts each broadcast from the outbox rows of that broadcast only', async () => {
  crowd(STORE_A, 3);
  const made = await json(await send(STORE_A, tokenA, draft(3)));
  // One row of ANOTHER broadcast whose id merely starts with the same characters must not be counted.
  const lastChar = String(made.id).slice(23);
  const neighbour = String(made.id).slice(0, 23) + (lastChar === '0' ? '1' : '0');
  outbox.push({ _id: new mongoose.Types.ObjectId(), dedupeKey: 'broadcast:' + neighbour + ':x@example.com', status: 'sent', template: 'broadcast', to: 'x@example.com' });
  outbox[0]!.status = 'sent';
  outbox[1]!.status = 'failed';
  const list = await json(await getHistory(STORE_A, tokenA));
  assert.equal(list.totalDocs, 1);
  assert.deepEqual(list.docs[0].counts, { queued: 1, sent: 1, failed: 1, skipped: 0 });
  assert.equal(list.docs[0].recipientCount, 3);
});

// ---------------------------------------------------------------------------------------------- count and daily limit

test('the confirmed count must equal the current count (409), and nobody to send to is 422', async () => {
  crowd(STORE_A, 2);
  const wrong = await send(STORE_A, tokenA, draft(3));
  assert.equal(wrong.status, 409);
  assert.equal((await json(wrong)).code, 'BROADCAST_COUNT_CHANGED');
  assert.equal(broadcasts.length, 0);
  assert.equal(outbox.length, 0);

  const nobody = await send(STORE_B, tokenB, draft(0));
  assert.equal(nobody.status, 422);
  assert.equal((await json(nobody)).code, 'BROADCAST_NO_RECIPIENTS');
});

test('one broadcast per store per day: two creates at once leave exactly one, and the loser queues nothing', async () => {
  crowd(STORE_A, 2);
  const [first, second] = await Promise.all([send(STORE_A, tokenA, draft(2)), send(STORE_A, tokenA, draft(2, { subject: 'Second' }))]);
  assert.deepEqual([first.status, second.status].sort(), [201, 429]);
  const loser = first.status === 429 ? first : second;
  assert.equal((await json(loser)).code, 'BROADCAST_DAILY_LIMIT');
  assert.equal(broadcasts.length, 1);
  assert.equal(outbox.length, 2, 'only the winner queued its recipients');

  const later = await send(STORE_A, tokenA, draft(2));
  assert.equal(later.status, 429);
  assert.equal(broadcasts.length, 1);
});

test('another store may still broadcast the same day', async () => {
  crowd(STORE_A, 1);
  crowd(STORE_B, 1, 'b');
  assert.equal((await send(STORE_A, tokenA, draft(1))).status, 201);
  assert.equal((await send(STORE_B, tokenB, draft(1))).status, 201);
  assert.equal(broadcasts.length, 2);
});

// ----------------------------------------------------------------------------------------------- who may do what

test('an unverified seller email cannot send a broadcast (403 EMAIL_NOT_VERIFIED)', async () => {
  crowd(STORE_C, 2);
  const res = await send(STORE_C, tokenC, draft(2));
  assert.equal(res.status, 403);
  assert.equal((await json(res)).code, 'EMAIL_NOT_VERIFIED');
  assert.equal(broadcasts.length, 0);
  assert.equal(outbox.length, 0);
});

test('without UNSUBSCRIBE_SIGNING_SECRET, or with one under 16 characters, a broadcast answers 503 and queues nothing', async () => {
  crowd(STORE_A, 2);
  delete process.env.UNSUBSCRIBE_SIGNING_SECRET;
  const missing = await send(STORE_A, tokenA, draft(2));
  assert.equal(missing.status, 503);
  assert.equal((await json(missing)).code, 'BROADCAST_NOT_CONFIGURED');
  process.env.UNSUBSCRIBE_SIGNING_SECRET = 'short-15-chars!';
  assert.equal((await send(STORE_A, tokenA, draft(2))).status, 503);
  process.env.UNSUBSCRIBE_SIGNING_SECRET = '16-characters-ok';
  assert.equal((await send(STORE_A, tokenA, draft(2))).status, 201);
  assert.equal(broadcasts.length, 1);
});

test("Seller B and an admin cannot read Seller A's customers, preview, read the history or send to them", async () => {
  crowd(STORE_A, 3);
  for (const token of [tokenB, tokenAdmin]) {
    assert.equal((await getCustomers(STORE_A, token)).status, 403);
    assert.equal((await preview(STORE_A, token)).status, 403);
    assert.equal((await getHistory(STORE_A, token)).status, 403);
    assert.equal((await send(STORE_A, token, draft(3))).status, 403);
  }
  assert.equal(broadcasts.length, 0);
  assert.equal(outbox.length, 0);
  assert.equal(await (await getCustomers(STORE_A, '')).status, 401);

  // Seller B's own store shows only B's customers.
  sell(STORE_B, 'b-customer@example.com');
  const own = await json(await getCustomers(STORE_B, tokenB));
  assert.equal(own.totalDocs, 1);
  assert.equal(own.docs[0].email, 'b-customer@example.com');
});

test('the subject, the message and the count are validated (400 with the field); HTML is refused', async () => {
  crowd(STORE_A, 1);
  const field = async (body: unknown) => {
    const res = await send(STORE_A, tokenA, body);
    assert.equal(res.status, 400);
    return (await json(res)).field;
  };
  assert.equal(await field(draft(1, { subject: 'x'.repeat(121) })), 'subject');
  assert.equal(await field(draft(1, { subject: '   ' })), 'subject');
  assert.equal(await field(draft(1, { message: 'x'.repeat(2001) })), 'message');
  assert.equal(await field(draft(1, { message: '<script>alert(1)</script>' })), 'message');
  assert.equal(await field({ subject: 'Hi', message: 'Hello' }), 'expectedCount');
  assert.equal(await field(draft(1, { extra: true })), 'extra');
  assert.equal((await preview(STORE_A, tokenA, { subject: 'x'.repeat(121), message: 'm' })).status, 400);
  assert.equal(broadcasts.length, 0);
  // The limits themselves are accepted.
  assert.equal((await preview(STORE_A, tokenA, { subject: 'x'.repeat(120), message: 'm'.repeat(2000) })).status, 200);
});

// -------------------------------------------------------------------------------------------------------- unsubscribe

test('a valid link unsubscribes the customer, answers the same the second time, and the broadcast skips them from then on', async () => {
  crowd(STORE_A, 2);
  const sig = signUnsubscribe(STORE_A, 'c0@example.com', SIGNING);
  const first = await unsubscribe(STORE_A, 'c0@example.com', sig);
  assert.equal(first.status, 200);
  assert.deepEqual(await json(first), { ok: true });
  const second = await unsubscribe(STORE_A, 'c0@example.com', sig);
  assert.equal(second.status, 200);
  assert.deepEqual(await json(second), { ok: true });
  assert.equal(unsubs.length, 1, 'recorded once');
  assert.equal(unsubs[0]!.email, 'c0@example.com');

  assert.equal((await json(await preview(STORE_A, tokenA))).recipientCount, 1);
  const customers = await json(await getCustomers(STORE_A, tokenA));
  assert.deepEqual((customers.docs as Row[]).map((c) => [c.email, c.unsubscribed]).sort(), [['c0@example.com', true], ['c1@example.com', false]]);
});

test('the email in the link is compared in lower case, and stored in lower case', async () => {
  const sig = signUnsubscribe(STORE_A, 'Mixed@Example.com', SIGNING);
  assert.equal((await unsubscribe(STORE_A, 'mixed@example.com', sig)).status, 200);
  assert.equal(unsubs[0]!.email, 'mixed@example.com');
});

test('a bad signature, a link for another store or another email, and a malformed link all answer the same 404 and write nothing', async () => {
  const good = signUnsubscribe(STORE_A, 'c0@example.com', SIGNING);
  const flipped = (good[0] === 'a' ? 'b' : 'a') + good.slice(1);
  const answers: Array<{ status: number; text: string }> = [];
  for (const [store, email, sig] of [
    [STORE_A, 'c0@example.com', flipped],
    [STORE_B, 'c0@example.com', good],
    [STORE_A, 'c1@example.com', good],
    [STORE_A, 'c0@example.com', 'not-a-signature'],
    ['not-a-store', 'c0@example.com', good],
  ] as const) {
    const res = await unsubscribe(store, email, sig);
    answers.push({ status: res.status, text: JSON.stringify(await json(res)) });
  }
  assert.ok(answers.every((answer) => answer.status === 404));
  assert.equal(new Set(answers.map((answer) => answer.text)).size, 1, 'the answer never says why');
  const notJson = await unsubscribePOST(new NextRequest('http://seller.test/api/unsubscribe', { method: 'POST', body: 'nope' }));
  assert.equal(notJson.status, 404);
  assert.equal(unsubs.length, 0);
  assert.equal(unsubWrites, 0);
});

test('without UNSUBSCRIBE_SIGNING_SECRET (or under 16 characters) every unsubscribe link answers 404, even one that was valid', async () => {
  const sig = signUnsubscribe(STORE_A, 'c0@example.com', SIGNING);
  delete process.env.UNSUBSCRIBE_SIGNING_SECRET;
  assert.equal((await unsubscribe(STORE_A, 'c0@example.com', sig)).status, 404);
  process.env.UNSUBSCRIBE_SIGNING_SECRET = 'short';
  assert.equal((await unsubscribe(STORE_A, 'c0@example.com', signUnsubscribe(STORE_A, 'c0@example.com', 'short'))).status, 404);
  assert.equal(unsubs.length, 0);
});

test('an unsubscribed customer still gets the order emails, and the store footer is added to them (HTML escaped)', async () => {
  unsubs.push({ store: STORE_A, email: 'ayesha@example.com', at: T0 });
  stores[STORE_A]!.storefront = { emailFooter: 'Questions? <b>WhatsApp</b> us on 0300 1234567.\nThank you!' };
  const order = {
    _id: '65a0000000000000000a0001',
    orderId: 'ORD-ABCD2345',
    store: STORE_A,
    status: 'confirmed',
    paymentMethod: 'cod',
    customerName: 'Ayesha',
    customerEmail: 'ayesha@example.com',
    phone: '+923001234567',
    city: 'Lahore',
    items: [{ productTitle: 'Lawn suit', variantTitle: 'Blue', unitPrice: 3500, quantity: 2 }],
    total: 7250,
  };
  await sendOrderPlaced(STORE_A, order);
  await sendOrderStatus(STORE_A, order, 'confirmed');
  const mine = outbox.filter((row) => row.to === 'ayesha@example.com');
  assert.deepEqual(mine.map((row) => row.template).sort(), ['order_confirmed', 'order_placed_customer']);
  for (const row of mine) {
    assert.ok(row.bodyText.includes('Questions? <b>WhatsApp</b> us on 0300 1234567.\nThank you!'));
    assert.ok(row.bodyHtml.includes('Questions? &lt;b&gt;WhatsApp&lt;/b&gt; us on 0300 1234567.<br>Thank you!'));
    assert.equal(row.bodyHtml.includes('<b>WhatsApp</b>'), false);
  }
  const sellerMail = outbox.find((row) => row.template === 'order_placed_seller');
  assert.ok(sellerMail, 'the seller email is queued too');
  assert.equal(sellerMail.bodyText.includes('Questions?'), false, 'the footer is for the customer emails only');
});

test('an order email has no footer when the store set none', async () => {
  const order = { _id: '65a0000000000000000a0002', orderId: 'ORD-WXYZ2345', store: STORE_A, customerName: 'Ayesha', customerEmail: 'ayesha@example.com', total: 100, items: [] };
  await sendOrderStatus(STORE_A, order, 'delivered');
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]!.bodyText.endsWith('\n---\n'), false);
  assert.equal(outbox[0]!.bodyHtml.includes('<hr style="border:none;border-top:1px solid #ddd;margin:16px 0"><div dir="auto"'), false);
});

// ------------------------------------------------------------------------------------------------------ the message text

test('the broadcast email escapes the seller text in HTML, names the store and carries the store footer', async () => {
  stores[STORE_A]!.storefront = { emailFooter: 'Zara Lawn, Model Town Lahore' };
  crowd(STORE_A, 1);
  const res = await send(STORE_A, tokenA, draft(1, { subject: 'Sale & more', message: 'Line one\nLine two "quoted"' }));
  assert.equal(res.status, 201);
  const mail = outbox[0]!;
  assert.equal(mail.subject, 'Sale & more');
  assert.ok(mail.bodyHtml.includes('Line one<br>Line two &quot;quoted&quot;'));
  assert.ok(mail.bodyHtml.includes('Zara Lawn, Model Town Lahore'));
  assert.ok(mail.bodyHtml.includes('<a href="https://seller.markazify.com/unsubscribe?'));
  assert.ok(mail.bodyText.includes('You get this email because you ordered from Zara Lawn'));
  assert.ok(mail.bodyText.includes('ایسی ای میلز'), 'the Urdu part is there');
});

test('a store without a footer uses its name as the footer of a broadcast', async () => {
  crowd(STORE_A, 1);
  await send(STORE_A, tokenA, draft(1));
  assert.ok(outbox[0]!.bodyText.includes('Zara Lawn'));
});
