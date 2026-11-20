import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, CustomerNote, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { customerSearchStage, customersCsv, distinctAddresses, escapeRegex, filterStages, statsOf } from '@/lib/customers';
import { installCustomersWorld, makeOrder, type CustomersWorld, type Row } from './helpers/customers-world';

// Sprint 5 EP-10.US01 / US02 (D-107, D-108): the customer list, detail, note and CSV export. Every model is stubbed in memory (no
// database): the customers pipelines are interpreted by ./helpers/customers-world, which throws on a stage it does not know.
// Seller A owns store A, Seller B owns store B, and an admin session must be refused everywhere.

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const T0 = new Date('2026-11-14T10:00:00Z');

const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;

type Ctx = { params: Promise<{ id: string; key?: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let world: CustomersWorld;
let stores: Record<string, Row> = {};
let users: Record<string, Row> = {};
let audits: Row[] = [];
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};
let listGET: Handler;
let detailGET: Handler;
let notePATCH: Handler;
let exportGET: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  listGET = (await import('../src/app/api/stores/[id]/customers/route')).GET as Handler;
  detailGET = (await import('../src/app/api/stores/[id]/customers/[key]/route')).GET as Handler;
  notePATCH = (await import('../src/app/api/stores/[id]/customers/[key]/note/route')).PATCH as Handler;
  exportGET = (await import('../src/app/api/stores/[id]/customers/export/route')).GET as Handler;
});

const chain = (read: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => read() };
  return q;
};

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    store: Object.fromEntries(['findOne', 'exists', 'findById'].map((m) => [m, StoreModel[m]])),
    user: UserModel.findById,
    audit: AuditModel.create,
  };
  world = installCustomersWorld();
  audits = [];
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, name: 'Zara Lawn', slug: 'zara' },
    [STORE_B]: { _id: STORE_B, owner: USER_B, name: 'Bilal Shoes', slug: 'bilal' },
  };
  users = {
    [USER_A]: { _id: USER_A, role: 'seller', email: 'a@seller.test', emailVerifiedAt: T0 },
    [USER_B]: { _id: USER_B, role: 'seller', email: 'b@seller.test', emailVerifiedAt: T0 },
    [ADMIN]: { _id: ADMIN, role: 'admin', email: 'admin@markazify.test', emailVerifiedAt: T0 },
  };
  (mongoose as any).connect = async () => mongoose;
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
  restore = () => {
    world.restore();
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    UserModel.findById = saved.user;
    AuditModel.create = saved.audit;
  };
});

afterEach(() => restore());

// ------------------------------------------------------------------------------------------------------------ helpers

const sell = (store: string, fields: Row = {}): Row => {
  const order = makeOrder(store, fields);
  world.orders.push(order);
  return order;
};
const authed = (token: string) => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
const ctx = (id: string, key?: string): Ctx => ({ params: Promise.resolve({ id, ...(key === undefined ? {} : { key }) }) });
const base = (id: string) => 'http://seller.test/api/stores/' + id + '/customers';
const list = (id: string, token: string, query = '') => listGET(new NextRequest(base(id) + query, { headers: authed(token) }), ctx(id));
const detail = (id: string, token: string, key: string) => detailGET(new NextRequest(base(id) + '/' + encodeURIComponent(key), { headers: authed(token) }), ctx(id, key));
const note = (id: string, token: string, key: string, body: unknown) =>
  notePATCH(new NextRequest(base(id) + '/' + encodeURIComponent(key) + '/note', { method: 'PATCH', headers: authed(token), body: JSON.stringify(body) }), ctx(id, key));
const exportCsv = (id: string, token: string, query = '') => exportGET(new NextRequest(base(id) + '/export' + query, { headers: authed(token) }), ctx(id));
const json = async (res: Response) => (await res.json()) as Row;
const idsOf = (body: Row) => (body.docs as Row[]).map((c) => c.id);

const AYESHA = '+923001234567';
const BILAL = '+923007654321';

// ------------------------------------------------------------------------------------------ list: grouping and statistics

test('the list groups by phone first: three spellings of one phone are one customer, an order with no phone is grouped by email', async () => {
  sell(STORE_A, { phone: '0300-1234567', customerName: 'Ayesha', customerEmail: 'ayesha@example.com' });
  sell(STORE_A, { phone: '+92 300 1234567', customerName: 'Ayesha K' });
  sell(STORE_A, { phone: '3001234567' });
  sell(STORE_A, { phone: '', customerName: 'Email only', customerEmail: 'Walk@Example.com' });
  sell(STORE_A, { phone: 'not a phone', customerName: 'Junk phone', customerEmail: 'junk@example.com' });
  sell(STORE_A, { phone: '', customerEmail: null, customerName: 'Nobody' });
  sell(STORE_B, { phone: AYESHA, customerName: 'Other store' });
  const body = await json(await list(STORE_A, tokenA));
  assert.equal(body.totalDocs, 3, 'ayesha, email only, junk phone with an email; the order with neither is no customer');
  assert.deepEqual(idsOf(body).sort(), [AYESHA, 'junk@example.com', 'walk@example.com']);
  const ayesha = (body.docs as Row[]).find((c) => c.id === AYESHA)!;
  assert.equal(ayesha.orderCount, 3);
  assert.equal(ayesha.phone, AYESHA);
  assert.equal(ayesha.email, 'ayesha@example.com');
  assert.equal(JSON.stringify(body).includes('Other store'), false, 'store B never leaks into store A');
  for (const pipeline of world.pipelines) assert.equal(String(pipeline[0]!.$match.store), STORE_A, 'every read is scoped by the verified store');
});

test('statistics: delivered and cancelled counts, total spent is delivered items after the discount, the average is whole rupees', async () => {
  sell(STORE_A, { phone: AYESHA, status: 'delivered', subtotal: 1500, discountAmount: 100 });
  sell(STORE_A, { phone: AYESHA, status: 'delivered', subtotal: 1000, discountAmount: 0 });
  sell(STORE_A, { phone: AYESHA, status: 'delivered', subtotal: 100, discountAmount: 500 });
  sell(STORE_A, { phone: AYESHA, status: 'cancelled', subtotal: 9999 });
  sell(STORE_A, { phone: AYESHA, status: 'pending', subtotal: 5000 });
  const [customer] = (await json(await list(STORE_A, tokenA))).docs as Row[];
  assert.equal(customer.orderCount, 5);
  assert.equal(customer.deliveredCount, 3);
  assert.equal(customer.totalSpent, 1400 + 1000 + 0, 'a discount larger than the subtotal never goes below zero; cancelled and open orders are not spent');

  const detailBody = await json(await detail(STORE_A, tokenA, AYESHA));
  assert.deepEqual(
    { ...detailBody.stats, firstOrderAt: undefined, lastOrderAt: undefined },
    { orderCount: 5, deliveredCount: 3, cancelledCount: 1, totalSpent: 2400, averageOrderValue: 800, firstOrderAt: undefined, lastOrderAt: undefined, returnsCount: 0 },
  );
});

test('statsOf: no delivered order is an average of 0, and the average is rounded', () => {
  assert.equal(statsOf({ _id: 'x', orders: 2, deliveredCount: 0, totalSpent: 0 }).averageOrderValue, 0);
  assert.equal(statsOf({ _id: 'x', orders: 3, deliveredCount: 3, totalSpent: 1000 }).averageOrderValue, 333);
  assert.equal(statsOf({ _id: 'x', orders: 1 }).returnsCount, 0, 'zero unless the caller passes the real count');
  assert.equal(statsOf({ _id: 'x', orders: 1 }, 3).returnsCount, 3, 'SB-3: the real count is passed in (lib/returns.ts returnsCountFor)');
});

// ------------------------------------------------------------------------------------------ list: search, filters, sort, paging

test('search matches name, email and a phone typed in any spelling, case-insensitively', async () => {
  sell(STORE_A, { phone: AYESHA, customerName: 'Ayesha Khan', customerEmail: 'ayesha@example.com' });
  sell(STORE_A, { phone: BILAL, customerName: 'Bilal Ahmed' });
  const search = async (q: string) => idsOf(await json(await list(STORE_A, tokenA, '?q=' + encodeURIComponent(q))));
  assert.deepEqual(await search('ayesha'), [AYESHA]);
  assert.deepEqual(await search('AHMED'), [BILAL]);
  assert.deepEqual(await search('0300 1234'), [AYESHA]);
  assert.deepEqual(await search('+92 300 7654'), [BILAL]);
  assert.deepEqual(await search('3007654321'), [BILAL]);
  assert.deepEqual(await search('example.com'), [AYESHA]);
  assert.deepEqual(await search('nobody'), []);
});

test('search text is escaped: a pattern is plain text and never a regex', async () => {
  sell(STORE_A, { phone: AYESHA, customerName: 'Ayesha Khan' });
  const search = async (q: string) => idsOf(await json(await list(STORE_A, tokenA, '?q=' + encodeURIComponent(q))));
  for (const evil of ['.*', 'a.*', '(', '[a-z]+', '^A', 'Ayesha|', '\\', 'A)(', '$']) {
    assert.deepEqual(await search(evil), [], evil + ' is a literal text that matches nothing');
  }
  assert.equal(escapeRegex('a.b*c(d)[e]\\f$^|?+{}'), 'a\\.b\\*c\\(d\\)\\[e\\]\\\\f\\$\\^\\|\\?\\+\\{\\}');
  const stage = customerSearchStage('x.*(')!;
  for (const branch of (stage.$match as Row).$or as Row[]) {
    for (const cond of Object.values(branch) as Row[]) assert.equal(cond.$regex, 'x\\.\\*\\(', 'every branch carries the escaped text');
  }
  assert.equal(customerSearchStage('   '), null);
  assert.equal(customerSearchStage(undefined), null);
});

test('filters: repeat customers, has email, unsubscribed; sort by total spent and by orders', async () => {
  sell(STORE_A, { phone: AYESHA, customerName: 'Ayesha', customerEmail: 'ayesha@example.com', status: 'delivered', subtotal: 500 });
  sell(STORE_A, { phone: AYESHA, status: 'delivered', subtotal: 500 });
  sell(STORE_A, { phone: BILAL, customerName: 'Bilal', status: 'delivered', subtotal: 9000 });
  sell(STORE_A, { phone: '', customerName: 'Gone', customerEmail: 'gone@example.com' });
  world.unsubs.push({ store: STORE_A, email: 'gone@example.com', at: T0 });
  const ids = async (q: string) => idsOf(await json(await list(STORE_A, tokenA, q)));
  assert.deepEqual(await ids('?repeat=1'), [AYESHA]);
  assert.deepEqual((await ids('?hasEmail=1')).sort(), [AYESHA, 'gone@example.com']);
  assert.deepEqual(await ids('?unsubscribed=1'), ['gone@example.com']);
  assert.deepEqual(await ids('?sort=total_spent'), [BILAL, AYESHA, 'gone@example.com']);
  assert.deepEqual((await ids('?sort=orders'))[0], AYESHA);
  assert.deepEqual(await ids('?repeat=1&hasEmail=1&unsubscribed=1'), [], 'filters combine with AND');
  assert.deepEqual(await ids('?phone=1&sort=total_spent'), [BILAL, AYESHA], 'the broadcast page keeps its phone=1 list');
  const row = ((await json(await list(STORE_A, tokenA, '?unsubscribed=1'))).docs as Row[])[0]!;
  assert.equal(row.unsubscribed, true);
});

test('filterStages builds only what was asked, and the default order is the latest order first', () => {
  assert.deepEqual(filterStages({}, []), [{ $sort: { lastOrderAt: -1, _id: 1 } }]);
  const stages = filterStages({ repeat: '1', unsubscribed: '1', sort: 'orders' }, ['a@b.com']);
  assert.deepEqual(stages[0], { $match: { orders: { $gte: 2 } } });
  assert.deepEqual(stages[1], { $match: { email: { $in: ['a@b.com'] } } });
  assert.deepEqual(stages[2], { $sort: { orders: -1, lastOrderAt: -1, _id: 1 } });
});

test('paging: totalDocs and totalPages count the filtered customers, a page holds at most the limit', async () => {
  for (let i = 0; i < 5; i += 1) sell(STORE_A, { phone: '+9230012345' + String(10 + i) });
  const first = await json(await list(STORE_A, tokenA, '?limit=2&page=1'));
  assert.equal((first.docs as Row[]).length, 2);
  assert.equal(first.totalDocs, 5);
  assert.equal(first.totalPages, 3);
  assert.equal((await json(await list(STORE_A, tokenA, '?limit=2&page=3'))).docs.length, 1);
  assert.equal((await json(await list(STORE_A, tokenA, '?limit=2&page=9'))).docs.length, 0);
});

test('a bad list query is a 400 that names the field (sort, q too long, unknown key)', async () => {
  assert.equal((await json(await list(STORE_A, tokenA, '?sort=name'))).field, 'sort');
  assert.equal((await json(await list(STORE_A, tokenA, '?q=' + 'x'.repeat(81)))).field, 'q');
  assert.equal((await json(await list(STORE_A, tokenA, '?store=' + STORE_B))).field, 'store');
  assert.equal((await json(await list(STORE_A, tokenA, '?repeat=0'))).field, 'repeat');
});

// ------------------------------------------------------------------------------------------------------ scoping and auth

for (const [name, run] of [
  ['list', (id: string, token: string) => list(id, token)],
  ['detail', (id: string, token: string) => detail(id, token, AYESHA)],
  ['note', (id: string, token: string) => note(id, token, AYESHA, { note: 'x' })],
  ['export', (id: string, token: string) => exportCsv(id, token)],
] as const) {
  test(name + ': Seller B on store A is 403, an admin session is 403, no session is 401, an unknown store is 404', async () => {
    sell(STORE_A, { phone: AYESHA });
    assert.equal((await run(STORE_A, tokenB)).status, 403, 'another seller');
    assert.equal((await run(STORE_A, tokenAdmin)).status, 403, 'an admin');
    assert.equal((await run('65a0000000000000000000ff', tokenA)).status, 403, 'a store id that is not the seller own is refused like a foreign one');
    assert.equal((await run('not-an-id', tokenA)).status, 404);
    const anonymous = await listGET(new NextRequest(base(STORE_A)), ctx(STORE_A));
    assert.equal(anonymous.status, 401);
    assert.equal(world.noteWrites.length, 0, 'a refused call wrote nothing');
  });
}

// ----------------------------------------------------------------------------------------------------------------- detail

test('detail: statistics, orders newest first with their ids, distinct addresses, any spelling of the phone finds the customer', async () => {
  const first = sell(STORE_A, { phone: AYESHA, customerName: 'Ayesha', address: 'House 1, Street 2', city: 'Lahore', status: 'delivered' });
  sell(STORE_A, { phone: '0300 1234567', address: 'house 1,  street 2', city: 'lahore' });
  const last = sell(STORE_A, { phone: '3001234567', address: 'Shop 9, Mall Road', city: 'Multan', status: 'pending' });
  world.notes.push({ store: STORE_A, key: AYESHA, note: 'Call after 6 pm', tags: ['VIP'], updatedAt: T0 });

  for (const spelling of [AYESHA, '03001234567', '0300-1234567', '+92 300 1234567']) {
    const res = await detail(STORE_A, tokenA, spelling);
    assert.equal(res.status, 200, spelling);
  }
  const body = await json(await detail(STORE_A, tokenA, '0300 1234567'));
  assert.equal(body.id, AYESHA);
  assert.equal(body.phone, AYESHA);
  assert.equal(body.note, 'Call after 6 pm');
  assert.deepEqual(body.tags, ['VIP']);
  assert.deepEqual((body.orders as Row[]).map((o) => o.orderId), [last.orderId, (world.orders[1] as Row).orderId, first.orderId], 'newest first');
  assert.equal((body.orders as Row[])[0]!.id, String(last._id));
  assert.deepEqual(Object.keys((body.orders as Row[])[0]!).sort(), ['createdAt', 'id', 'orderId', 'paymentMethod', 'paymentStatus', 'status', 'total']);
  assert.deepEqual(
    body.addresses,
    [
      { address: 'Shop 9, Mall Road', city: 'Multan' },
      { address: 'house 1,  street 2', city: 'lahore' },
    ],
    'the same address typed with other spacing or case is listed once, in the spelling of its newest order',
  );
  assert.equal(body.stats.orderCount, 3);
});

test('detail: an email customer is found by its address in any case; a key with no order in THIS store is 404, even when another store has it', async () => {
  sell(STORE_A, { phone: '', customerEmail: 'walk@example.com', customerName: 'Walk' });
  sell(STORE_B, { phone: BILAL, customerName: 'Store B customer' });
  assert.equal((await detail(STORE_A, tokenA, 'Walk@Example.com')).status, 200);
  assert.equal((await detail(STORE_A, tokenA, BILAL)).status, 404, 'a customer of store B is not a customer of store A');
  assert.equal((await detail(STORE_B, tokenB, BILAL)).status, 200);
  assert.equal((await detail(STORE_A, tokenA, '+923009999999')).status, 404);
  assert.equal(JSON.stringify(await json(await detail(STORE_A, tokenA, 'walk@example.com'))).includes('Store B'), false);
  for (const pipeline of world.pipelines) assert.equal(String(pipeline[0]!.$match.store) === STORE_A || String(pipeline[0]!.$match.store) === STORE_B, true);
});

test('detail: a key that is neither a mobile number nor an email is 400 naming the field key, before anything is read', async () => {
  for (const bad of ['abc', '12345', '+441234567890', 'a@b', '']) {
    const res = await detail(STORE_A, tokenA, bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal((await json(res)).field, 'key');
  }
  assert.equal(world.pipelines.length, 0);
});

test('a phone-key detail starts from the { store, phoneKey } index', async () => {
  sell(STORE_A, { phone: AYESHA });
  await detail(STORE_A, tokenA, AYESHA);
  assert.equal(world.pipelines[0]![0]!.$match.phoneKey, AYESHA);
});

test('distinctAddresses: newest first, trimmed and case-folded, capped', () => {
  const orders = Array.from({ length: 15 }, (_, i) => ({ address: 'Address ' + i + ' Road', city: 'Karachi' }));
  assert.equal(distinctAddresses(orders).length, 10);
  assert.deepEqual(distinctAddresses([{ address: ' A  b ', city: 'X' }, { address: 'a b', city: 'x' }, { address: '', city: 'X' }, { address: null }]), [{ address: 'A  b', city: 'X' }]);
});

// ------------------------------------------------------------------------------------------------------------------- note

test('note: saves the note and tags with ONE upsert on { store, key }, returns what was stored, and the list shows the tags', async () => {
  sell(STORE_A, { phone: AYESHA });
  const res = await note(STORE_A, tokenA, '0300 1234567', { note: '  Prefers calls.\r\nNo Sunday delivery.  ', tags: [' VIP ', 'vip', 'Eid  buyer'] });
  assert.equal(res.status, 200);
  const saved = await json(res);
  assert.equal(saved.note, 'Prefers calls.\nNo Sunday delivery.');
  assert.deepEqual(saved.tags, ['VIP', 'Eid buyer'], 'trimmed, spaces collapsed, a repeat in another case dropped');
  assert.equal(world.noteWrites.length, 1, 'one write');
  assert.equal(world.noteWrites[0]!.options.upsert, true);
  assert.equal(String(world.noteWrites[0]!.filter.store), STORE_A);
  assert.equal(world.noteWrites[0]!.filter.key, AYESHA, 'the key is normalized, whatever the spelling in the URL');
  assert.equal(String(world.noteWrites[0]!.update.$set.updatedBy), USER_A);
  const row = ((await json(await list(STORE_A, tokenA))).docs as Row[])[0]!;
  assert.deepEqual(row.tags, ['VIP', 'Eid buyer']);
});

test('note: only the fields sent are written; an empty note clears it; tags can be cleared with an empty list', async () => {
  sell(STORE_A, { phone: AYESHA });
  await note(STORE_A, tokenA, AYESHA, { note: 'first', tags: ['a'] });
  await note(STORE_A, tokenA, AYESHA, { tags: ['b'] });
  assert.deepEqual(Object.keys(world.noteWrites[1]!.update.$set).sort(), ['tags', 'updatedBy']);
  assert.equal(world.notes[0]!.note, 'first', 'the note was not touched by a tags-only save');
  const cleared = await json(await note(STORE_A, tokenA, AYESHA, { note: '   ', tags: [] }));
  assert.equal(cleared.note, '');
  assert.deepEqual(cleared.tags, []);
  assert.equal(world.notes.length, 1, 'still one row for the customer');
});

test('note validation: strict, plain text, 500 characters, 5 tags of 20, the 400 names the field and nothing is written', async () => {
  sell(STORE_A, { phone: AYESHA });
  const field = async (body: unknown) => {
    const res = await note(STORE_A, tokenA, AYESHA, body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    return (await json(res)).field;
  };
  assert.equal(await field({}), 'note', 'an empty body');
  assert.equal(await field({ note: 'x'.repeat(501) }), 'note');
  assert.equal(await field({ note: '<script>alert(1)</script>' }), 'note');
  assert.equal(await field({ note: 5 }), 'note');
  assert.equal(await field({ tags: ['1', '2', '3', '4', '5', '6'] }), 'tags');
  assert.equal(await field({ tags: ['x'.repeat(21)] }), 'tags.0');
  assert.equal(await field({ tags: ['ok', ''] }), 'tags.1');
  assert.equal(await field({ tags: ['<b>'] }), 'tags.0');
  assert.equal(await field({ tags: 'vip' }), 'tags');
  assert.equal(await field({ note: 'fine', store: STORE_B }), 'store', 'an unknown field is refused');
  assert.equal(await field({ note: 'fine', updatedBy: USER_B }), 'updatedBy');
  assert.equal(world.noteWrites.length, 0);
  const exactly = await note(STORE_A, tokenA, AYESHA, { note: 'x'.repeat(500), tags: ['1', '2', '3', '4', '5'].map((t) => t.repeat(20)) });
  assert.equal(exactly.status, 200, 'the limits themselves are allowed');
  const notJson = await notePATCH(new NextRequest(base(STORE_A) + '/' + encodeURIComponent(AYESHA) + '/note', { method: 'PATCH', headers: authed(tokenA), body: 'nope' }), ctx(STORE_A, AYESHA));
  assert.equal((await json(notJson)).field, 'body');
});

test('note: a customer this store does not have is 404 and nothing is written (another store is not a way in)', async () => {
  sell(STORE_B, { phone: BILAL });
  assert.equal((await note(STORE_A, tokenA, BILAL, { note: 'x' })).status, 404);
  assert.equal((await note(STORE_A, tokenA, '+923009999999', { note: 'x' })).status, 404);
  assert.equal((await note(STORE_A, tokenA, 'abc', { note: 'x' })).status, 400);
  assert.equal(world.noteWrites.length, 0);
});

test('note: the audit entry never holds the note text, a tag or the customer key', async () => {
  sell(STORE_A, { phone: AYESHA, customerEmail: 'ayesha@example.com' });
  const secret = 'Owes me Rs 5000 SECRET-NOTE';
  assert.equal((await note(STORE_A, tokenA, AYESHA, { note: secret, tags: ['SECRET-TAG'] })).status, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'customer.note');
  const dump = JSON.stringify(audits);
  for (const forbidden of ['SECRET-NOTE', 'SECRET-TAG', 'Owes me', AYESHA, '923001234567', 'ayesha@example.com']) assert.equal(dump.includes(forbidden), false, forbidden);
  assert.match(dump, /"noteChanged":true/);
  assert.match(dump, /"tagCount":1/);
});

test('note: a failing audit write never fails the save', async () => {
  sell(STORE_A, { phone: AYESHA });
  AuditModel.create = async () => {
    throw new Error('audit down');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await note(STORE_A, tokenA, AYESHA, { note: 'ok' })).status, 200);
  } finally {
    console.error = quiet;
  }
});

test('note: two saves racing on a new customer both succeed (the loser of the unique index retries once)', async () => {
  sell(STORE_A, { phone: AYESHA });
  const NoteModel = CustomerNote as any;
  const upsert = NoteModel.findOneAndUpdate;
  let calls = 0;
  NoteModel.findOneAndUpdate = (...args: unknown[]) => {
    calls += 1;
    if (calls === 1) return { select: () => ({ lean: () => Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 })) }) };
    return upsert(...args);
  };
  assert.equal((await note(STORE_A, tokenA, AYESHA, { note: 'ok' })).status, 200);
  assert.equal(calls, 2);
  assert.equal(world.notes[0]!.note, 'ok');
});

// ------------------------------------------------------------------------------------------------------------------ export

test('export: UTF-8 BOM, header, quoted cells, store-scoped rows, attachment headers', async () => {
  sell(STORE_A, { phone: AYESHA, customerName: 'Ayesha, "the" Khan', customerEmail: 'ayesha@example.com', status: 'delivered', subtotal: 1200 });
  sell(STORE_A, { phone: '', customerName: 'عائشہ', customerEmail: 'urdu@example.com' });
  sell(STORE_B, { phone: BILAL, customerName: 'Other store' });
  const res = await exportCsv(STORE_A, tokenA);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="customers\.csv"/);
  assert.equal(res.headers.get('x-customers-truncated'), null);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a UTF-8 byte order mark');
  const text = new TextDecoder().decode(bytes);
  const lines = text.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[0], 'Name,Phone,Email,Orders,Delivered,Total spent,Last order,Unsubscribed');
  assert.equal(lines.length, 3);
  assert.equal(text.includes('Other store'), false);
  assert.ok(text.includes('"Ayesha, ""the"" Khan"'), 'a comma and quotes are quoted');
  assert.ok(text.includes('عائشہ'));
  assert.ok(lines.some((line) => line.endsWith(',1,1,1200,' + new Date((world.orders[0] as Row).createdAt).toISOString().slice(0, 10) + ',no')));
});

test('export: a cell starting with = + - @ is written as text so it can never run as a formula', async () => {
  for (const [i, name] of ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)'].entries()) sell(STORE_A, { phone: '+92300000000' + i, customerName: name });
  const text = await (await exportCsv(STORE_A, tokenA)).text();
  const cells = text.slice(1).trimEnd().split('\r\n').slice(1).map((line) => line.split(',')[0]!);
  for (const cell of cells) assert.match(cell, /^"?'[=+\-@]/, cell + ' starts with an apostrophe');
  // The phone starts with + too.
  assert.ok(text.includes("'+92300000000"), 'the phone column is guarded as well');
  const csv = customersCsv([{ id: 'k', name: '=cmd', email: '-x', phone: '@y', whatsapp: null, orderCount: 1, lastOrderAt: null, unsubscribed: true, deliveredCount: 0, totalSpent: 0, tags: [] }]);
  assert.ok(csv.includes("'=cmd,'@y,'-x,1,0,0,,yes"));
});

test('export: the same filters as the list, capped at 5000 rows with a truncation header', async () => {
  for (let i = 0; i < 5001; i += 1) sell(STORE_A, { phone: '+92300' + String(1000000 + i), customerName: 'C' + i });
  const res = await exportCsv(STORE_A, tokenA);
  assert.equal(res.headers.get('x-customers-truncated'), '1');
  assert.equal((await res.text()).slice(1).trimEnd().split('\r\n').length, 1 + 5000, 'the header and 5000 customers');
  const filtered = await exportCsv(STORE_A, tokenA, '?q=C4999');
  assert.equal((await filtered.text()).slice(1).trimEnd().split('\r\n').length, 2);
  assert.equal(filtered.headers.get('x-customers-truncated'), null);
});

test('export: a bad query is 400 with the field, and page and limit are not part of it', async () => {
  assert.equal((await json(await exportCsv(STORE_A, tokenA, '?sort=nope'))).field, 'sort');
  assert.equal((await json(await exportCsv(STORE_A, tokenA, '?page=2'))).field, 'page');
});


// ------------------------------------------------------------------------------------------------ Sprint 5 EP-13.US03.T05: returns count

test('the customer page counts the customer's real returns: by phoneKey, in this store, rejected ones not counted', async () => {
  sell(STORE_A, { phone: '0300 1234567', customerName: 'Ayesha' });
  sell(STORE_B, { phone: '0300 1234567', customerName: 'Ayesha elsewhere' });
  world.returns.push(
    { store: STORE_A, contactPhone: AYESHA, status: 'requested' },
    { store: STORE_A, contactPhone: AYESHA, status: 'refunded' },
    { store: STORE_A, contactPhone: AYESHA, status: 'rejected' },
    { store: STORE_A, contactPhone: BILAL, status: 'approved' },
    { store: STORE_B, contactPhone: AYESHA, status: 'approved' },
  );
  const a = await json(await detail(STORE_A, tokenA, AYESHA));
  assert.equal((a.stats as Row).returnsCount, 2);
  // Any spelling of the phone in the URL is the same customer and the same count.
  assert.equal(((await json(await detail(STORE_A, tokenA, '0300 1234567'))).stats as Row).returnsCount, 2);
  const b = await json(await detail(STORE_B, tokenB, AYESHA));
  assert.equal((b.stats as Row).returnsCount, 1, 'each store counts its own returns only');
});

test('a customer known only by email has no phone key and so no returns to count', async () => {
  sell(STORE_A, { phone: '', customerEmail: 'walk@example.com' });
  world.returns.push({ store: STORE_A, contactPhone: AYESHA, status: 'requested' });
  const res = await json(await detail(STORE_A, tokenA, 'walk@example.com'));
  assert.equal((res.stats as Row).returnsCount, 0);
});
