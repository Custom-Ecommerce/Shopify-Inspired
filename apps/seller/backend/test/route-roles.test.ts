import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Order, Return, Review, SellerAlert, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { auditActorOf, type AuthContext } from '../src/lib/auth';
import { resolveOwnedStoreId, setMembershipListLoader, setMembershipLoader } from '../src/lib/data-plane';
import { setSessionUserLoader } from '../src/lib/session-user';
import { ALERT_KINDS_BY_ROLE, alertFilterFor, alertKindsFor } from '../src/lib/seller-alerts';
import { settingsForRole, storeDocForRole } from '../src/lib/store-settings';
import { ROUTE_CAPABILITIES, roleMayCall } from '../src/lib/route-capabilities';

// Sprint 8 (S8-B3, D-118): the REAL route handlers of a sample of 15 routes, run as every role: a role without the capability is 403 CAPABILITY_DENIED before anything is read, a foreign
// store is a plain 403 for every role, a foreign record is a 404, a removed member is refused on the very next request, and the owner is unaffected. The member row is read through
// the loader seam from a live table, as the database is on every request. No model is stubbed for the denials: a route that read anything before refusing would hang or throw here.

const SECRET = 'x'.repeat(40);
const OWNER_A = '65a000000000000000000001';
const OWNER_B = '65a000000000000000000002';
const MANAGER = '65a000000000000000000003';
const STAFF = '65a000000000000000000004';
const SUPPORT = '65a000000000000000000005';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const FOREIGN_RECORD = '65a0000000000000000a0099';

const StoreModel = Store as any;
const tokens: Record<string, string> = {};
const roleOf: Record<string, string> = { manager: MANAGER, staff: STAFF, support: SUPPORT };
let members: Record<string, { role: string; status: string } | undefined>;
let restore: () => void = () => {};

type Handler = (request: NextRequest, context: any) => Promise<Response>;

/** The sample: the route key of the map, the handler, and whether the store id is the path parameter (stores/[id]/...) or the x-store-id header. */
const SAMPLE: Array<{ key: string; load: () => Promise<Handler>; pathStore: boolean }> = [
  { key: 'inventory GET', load: async () => (await import('../src/app/api/inventory/route')).GET as Handler, pathStore: false },
  { key: 'discounts GET', load: async () => (await import('../src/app/api/discounts/route')).GET as Handler, pathStore: false },
  { key: 'analytics GET', load: async () => (await import('../src/app/api/analytics/route')).GET as Handler, pathStore: false },
  { key: 'contactMessages GET', load: async () => (await import('../src/app/api/contactMessages/route')).GET as Handler, pathStore: false },
  { key: 'reviews GET', load: async () => (await import('../src/app/api/reviews/route')).GET as Handler, pathStore: false },
  { key: 'products GET', load: async () => (await import('../src/app/api/products/route')).GET as Handler, pathStore: false },
  { key: 'storePages GET', load: async () => (await import('../src/app/api/storePages/route')).GET as Handler, pathStore: false },
  { key: 'stores/[id]/customers GET', load: async () => (await import('../src/app/api/stores/[id]/customers/route')).GET as Handler, pathStore: true },
  { key: 'stores/[id]/earnings GET', load: async () => (await import('../src/app/api/stores/[id]/earnings/route')).GET as Handler, pathStore: true },
  { key: 'stores/[id]/commission GET', load: async () => (await import('../src/app/api/stores/[id]/commission/route')).GET as Handler, pathStore: true },
  { key: 'stores/[id]/domain GET', load: async () => (await import('../src/app/api/stores/[id]/domain/route')).GET as Handler, pathStore: true },
  { key: 'stores/[id]/team GET', load: async () => (await import('../src/app/api/stores/[id]/team/route')).GET as Handler, pathStore: true },
  { key: 'stores/[id]/readiness GET', load: async () => (await import('../src/app/api/stores/[id]/readiness/route')).GET as Handler, pathStore: true },
  { key: 'stores/[id]/plan-usage GET', load: async () => (await import('../src/app/api/stores/[id]/plan-usage/route')).GET as Handler, pathStore: true },
  { key: 'stores/[id]/abandoned-carts GET', load: async () => (await import('../src/app/api/stores/[id]/abandoned-carts/route')).GET as Handler, pathStore: true },
];

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  for (const [name, id] of [['owner', OWNER_A], ['ownerB', OWNER_B], ['manager', MANAGER], ['staff', STAFF], ['support', SUPPORT]] as const) {
    tokens[name] = await signSession({ sub: id, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  }
});

beforeEach(() => {
  members = {
    [STORE_A + ':' + MANAGER]: { role: 'manager', status: 'active' },
    [STORE_A + ':' + STAFF]: { role: 'staff', status: 'active' },
    [STORE_A + ':' + SUPPORT]: { role: 'support', status: 'active' },
  };
  const saved = { connect: (mongoose as any).connect, exists: StoreModel.exists };
  (mongoose as any).connect = async () => mongoose;
  const owners: Record<string, string> = { [STORE_A]: OWNER_A, [STORE_B]: OWNER_B };
  StoreModel.exists = async (filter: any) => (owners[String(filter._id)] === String(filter.owner) ? { _id: filter._id } : null);
  setSessionUserLoader(async () => ({ role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date() }) as never);
  setMembershipLoader(async (storeId, userId) => {
    const row = members[storeId + ':' + userId];
    return row && row.status === 'active' ? { role: row.role } : null;
  });
  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.exists = saved.exists;
    setSessionUserLoader(null);
    setMembershipLoader(null);
    setMembershipListLoader(null);
  };
});

afterEach(() => restore());

async function call(entry: (typeof SAMPLE)[number], who: string, storeId: string): Promise<Response> {
  const handler = await entry.load();
  const path = '/api/' + entry.key.replace(/ GET$/, '').replace('[id]', storeId);
  const request = new NextRequest('http://seller.test' + path, { headers: { authorization: 'Bearer ' + tokens[who], 'x-store-id': storeId } });
  return handler(request, { params: Promise.resolve({ id: storeId }) });
}

const codeOf = async (res: Response): Promise<string | undefined> => {
  const body = (await res.json().catch(() => ({}))) as { code?: string; errors?: Array<{ code?: string }> };
  return body.code ?? body.errors?.[0]?.code;
};

test('the sample is mapped: 15 routes, all store routes, each denied to at least one role', () => {
  assert.equal(SAMPLE.length, 15);
  for (const entry of SAMPLE) {
    assert.ok(entry.key in ROUTE_CAPABILITIES, entry.key);
    assert.ok((['manager', 'staff', 'support'] as const).some((role) => !roleMayCall(role, entry.key)), entry.key + ' is denied to some role');
  }
});

test('a role WITHOUT the capability is 403 CAPABILITY_DENIED on every route of the sample (the map decides, the handler obeys)', async () => {
  let denied = 0;
  for (const entry of SAMPLE) {
    for (const role of ['manager', 'staff', 'support'] as const) {
      if (roleMayCall(role, entry.key)) continue;
      const res = await call(entry, role, STORE_A);
      assert.equal(res.status, 403, role + ' ' + entry.key);
      assert.equal(await codeOf(res), 'CAPABILITY_DENIED', role + ' ' + entry.key);
      denied += 1;
    }
  }
  assert.ok(denied >= 25, String(denied));
});

test('cross-store isolation: a member of Store A is a stranger in Store B on every route of the sample, for all three roles (plain 403, no capability code)', async () => {
  for (const entry of SAMPLE) {
    for (const role of ['manager', 'staff', 'support'] as const) {
      const res = await call(entry, role, STORE_B);
      assert.equal(res.status, 403, role + ' ' + entry.key);
      assert.equal(await codeOf(res), undefined, role + ' ' + entry.key + ': a stranger is told nothing about roles');
    }
    assert.equal((await call(entry, 'owner', STORE_B)).status, 403, 'the owner of A on Store B: ' + entry.key);
    assert.equal((await call(entry, 'ownerB', STORE_A)).status, 403, 'the owner of B on Store A: ' + entry.key);
  }
});

test('a removed, disabled or invited member is refused on the VERY NEXT request on every route of the sample', async () => {
  for (const status of ['disabled', 'invited', 'removed'] as const) {
    for (const entry of SAMPLE) {
      // The member row changes between requests (the loader reads the live table, as the database is read on every request).
      members[STORE_A + ':' + MANAGER] = { role: 'manager', status: 'active' };
      if (status === 'removed') delete members[STORE_A + ':' + MANAGER];
      else members[STORE_A + ':' + MANAGER] = { role: 'manager', status };
      const after = await call(entry, 'manager', STORE_A);
      assert.equal(after.status, 403, status + ' ' + entry.key);
      assert.equal(await codeOf(after), undefined, status + ' ' + entry.key + ': a stranger');
    }
  }
});

test('a role change takes effect on the very next request: a manager made support loses the routes of a manager', async () => {
  const entry = SAMPLE.find((item) => item.key === 'discounts GET')!;
  members[STORE_A + ':' + MANAGER] = { role: 'support', status: 'active' };
  const res = await call(entry, 'manager', STORE_A);
  assert.equal(res.status, 403);
  assert.equal(await codeOf(res), 'CAPABILITY_DENIED');
});

// ----------------------------------------------------------------------------------------------- a foreign record is a 404, for the roles that may read it

function chainOf(value: unknown) {
  const q: any = { select: () => q, sort: () => q, lean: async () => value };
  return q;
}

test('a foreign record id is a 404 for the roles that may read it (the owner too), and a role without the capability never gets that far: 403', async () => {
  const saved = { order: (Order as any).findOne, ret: (Return as any).findOne, review: (Review as any).findOne };
  const seen: any[] = [];
  (Order as any).findOne = (filter: any) => (seen.push(['order', filter]), chainOf(null));
  (Return as any).findOne = (filter: any) => (seen.push(['return', filter]), chainOf(null));
  (Review as any).findOne = (filter: any) => (seen.push(['review', filter]), chainOf(null));
  try {
    const orders = (await import('../src/app/api/orders/[id]/route')).GET as Handler;
    const returns = (await import('../src/app/api/returns/[id]/route')).GET as Handler;
    const reviews = (await import('../src/app/api/reviews/[id]/route')).GET as Handler;
    const hit = (handler: Handler, path: string, who: string) =>
      handler(new NextRequest('http://seller.test' + path + '/' + FOREIGN_RECORD, { headers: { authorization: 'Bearer ' + tokens[who], 'x-store-id': STORE_A } }), { params: Promise.resolve({ id: FOREIGN_RECORD }) });
    for (const who of ['owner', 'manager', 'staff', 'support']) {
      assert.equal((await hit(orders, '/api/orders', who)).status, 404, 'order ' + who);
    }
    for (const who of ['owner', 'manager', 'support']) {
      assert.equal((await hit(returns, '/api/returns', who)).status, 404, 'return ' + who);
      assert.equal((await hit(reviews, '/api/reviews', who)).status, 404, 'review ' + who);
    }
    const staffReturn = await hit(returns, '/api/returns', 'staff');
    assert.equal(staffReturn.status, 403);
    assert.equal(await codeOf(staffReturn), 'CAPABILITY_DENIED');
    assert.equal((await hit(reviews, '/api/reviews', 'staff')).status, 403);
    // The lookup always names the verified store: another store's record cannot match.
    for (const [, filter] of seen) assert.equal(String(filter.store), STORE_A);
    assert.equal(seen.length, 4 + 3 + 3);
  } finally {
    (Order as any).findOne = saved.order;
    (Return as any).findOne = saved.ret;
    (Review as any).findOne = saved.review;
  }
});

// ----------------------------------------------------------------------------------------------- the resolver sets the role the audit entries carry

const ctxOf = (userId: string): AuthContext => ({ userId, userObjectId: new mongoose.Types.ObjectId(userId), role: 'seller', actor: 'seller', tokenVersion: 0 });
const reqFor = (storeId: string) => new NextRequest('http://seller.test/api/x', { headers: { 'x-store-id': storeId } });

test('an audit entry of a member action carries the member user id AND role; the owner keeps the plain form', async () => {
  const owner = ctxOf(OWNER_A);
  assert.equal(auditActorOf(owner), 'seller:' + OWNER_A, 'before a store is resolved there is no role');
  await resolveOwnedStoreId(reqFor(STORE_A), owner, null, { capability: 'orders.read' });
  assert.equal(owner.storeRole, 'owner');
  assert.equal(auditActorOf(owner), 'seller:' + OWNER_A);

  for (const [name, id] of [['manager', MANAGER], ['staff', STAFF], ['support', SUPPORT]] as const) {
    const ctx = ctxOf(id);
    await resolveOwnedStoreId(reqFor(STORE_A), ctx, null, { capability: 'orders.read' });
    assert.equal(ctx.storeRole, name);
    assert.equal(auditActorOf(ctx), 'seller:' + id + ':' + name);
  }
  assert.equal(auditActorOf({ userId: 'u1', storeRole: null }), 'seller:u1', 'an admin session names no role');
  assert.equal(auditActorOf({ userId: 'u1', storeRole: 'owner' }), 'seller:u1');
});

test('the role of a failed resolution is never left on the context (a refused member keeps none)', async () => {
  const ctx = ctxOf(STAFF);
  await assert.rejects(resolveOwnedStoreId(reqFor(STORE_A), ctx, null, { capability: 'customers.read' }));
  assert.equal(ctx.storeRole, undefined);
  assert.equal(auditActorOf(ctx), 'seller:' + STAFF);
});

// ----------------------------------------------------------------------------------------------- the bell

test('the bell: the owner and a manager see every kind; staff the order and stock alerts; support the order, return, review and contact alerts; an unknown role none', () => {
  assert.equal(alertKindsFor('owner'), null);
  assert.equal(alertKindsFor('manager'), null);
  assert.deepEqual(alertKindsFor('staff'), ['new_order', 'unconfirmed_order', 'low_stock', 'out_of_stock']);
  assert.deepEqual(alertKindsFor('support'), ['new_order', 'return_requested', 'review_received', 'contact_message']);
  for (const role of [undefined, null, '', 'admin', 'god', 7]) assert.deepEqual(alertKindsFor(role), [], String(role));
  assert.deepEqual(alertFilterFor(STORE_A, 'owner'), { store: STORE_A }, 'the owner query is the one it always was');
  assert.deepEqual(alertFilterFor(STORE_A, 'support'), { store: STORE_A, kind: { $in: ['new_order', 'return_requested', 'review_received', 'contact_message'] } });
  assert.deepEqual(alertFilterFor(STORE_A, 'nobody'), { store: STORE_A, kind: { $in: [] } });
});

test('every alert kind reaches the owner, and a new order reaches every role; a contact message and a return request reach owner, manager and support only', () => {
  const kinds = ['new_order', 'low_stock', 'out_of_stock', 'unconfirmed_order', 'return_requested', 'review_received', 'contact_message'];
  const sees = (role: string, kind: string) => {
    const allowed = ALERT_KINDS_BY_ROLE[role];
    return allowed === null || allowed!.includes(kind);
  };
  for (const kind of kinds) assert.equal(sees('owner', kind), true, kind);
  for (const role of ['owner', 'manager', 'staff', 'support']) assert.equal(sees(role, 'new_order'), true, role);
  for (const kind of ['contact_message', 'return_requested']) {
    assert.deepEqual(['owner', 'manager', 'staff', 'support'].filter((role) => sees(role, kind)), ['owner', 'manager', 'support'], kind);
  }
  assert.deepEqual(['owner', 'manager', 'staff', 'support'].filter((role) => sees(role, 'low_stock')), ['owner', 'manager', 'staff']);
});

interface AlertRow {
  _id: string;
  store: string;
  kind: string;
  readAt: Date | null;
}

test('the alert routes show a member only the alerts of their role: list, unread count, read-all and read-one (another kind is a 404)', async () => {
  const kinds = ['new_order', 'low_stock', 'out_of_stock', 'unconfirmed_order', 'return_requested', 'review_received', 'contact_message'];
  const rows: AlertRow[] = kinds.map((kind, index) => ({ _id: '65a0000000000000000d00' + String(10 + index), store: STORE_A, kind, readAt: null }));
  rows.push({ _id: '65a0000000000000000d0099', store: STORE_B, kind: 'new_order', readAt: null });
  const fits = (row: AlertRow, filter: any): boolean =>
    Object.entries(filter).every(([key, wanted]: [string, any]) => {
      if (wanted && typeof wanted === 'object' && '$in' in wanted) return wanted.$in.includes((row as any)[key]);
      if (wanted === null) return (row as any)[key] === null;
      return String((row as any)[key]) === String(wanted);
    });
  const saved = { find: (SellerAlert as any).find, count: (SellerAlert as any).countDocuments, many: (SellerAlert as any).updateMany, one: (SellerAlert as any).findOneAndUpdate, findOne: (SellerAlert as any).findOne };
  (SellerAlert as any).find = (filter: any) => {
    const q: any = { sort: () => q, skip: () => q, limit: () => q, lean: async () => rows.filter((row) => fits(row, filter)) };
    return q;
  };
  (SellerAlert as any).countDocuments = async (filter: any) => rows.filter((row) => fits(row, filter)).length;
  (SellerAlert as any).updateMany = async (filter: any) => {
    const hit = rows.filter((row) => fits(row, filter));
    for (const row of hit) row.readAt = new Date();
    return { modifiedCount: hit.length };
  };
  (SellerAlert as any).findOneAndUpdate = (filter: any) => ({ lean: async () => rows.find((row) => fits(row, filter)) ?? null });
  (SellerAlert as any).findOne = (filter: any) => ({ lean: async () => rows.find((row) => fits(row, filter)) ?? null });
  try {
    const list = (await import('../src/app/api/alerts/route')).GET as Handler;
    const count = (await import('../src/app/api/alerts/unread-count/route')).GET as Handler;
    const readAll = (await import('../src/app/api/alerts/read-all/route')).POST as Handler;
    const readOne = (await import('../src/app/api/alerts/[id]/read/route')).POST as Handler;
    const req = (path: string, who: string, method = 'GET') => new NextRequest('http://seller.test' + path, { method, headers: { authorization: 'Bearer ' + tokens[who], 'x-store-id': STORE_A } });
    const seen = async (who: string) => ((await (await list(req('/api/alerts', who), {})).json()) as { docs: Array<{ kind: string }> }).docs.map((doc) => doc.kind).sort();

    assert.deepEqual(await seen('owner'), [...kinds].sort(), 'the owner sees all seven and not the other store alert');
    assert.deepEqual(await seen('manager'), [...kinds].sort());
    assert.deepEqual(await seen('staff'), ['low_stock', 'new_order', 'out_of_stock', 'unconfirmed_order']);
    assert.deepEqual(await seen('support'), ['contact_message', 'new_order', 'return_requested', 'review_received']);

    assert.equal(((await (await count(req('/api/alerts/unread-count', 'owner'), {})).json()) as { unread: number }).unread, 7);
    assert.equal(((await (await count(req('/api/alerts/unread-count', 'staff'), {})).json()) as { unread: number }).unread, 4);
    assert.equal(((await (await count(req('/api/alerts/unread-count', 'support'), {})).json()) as { unread: number }).unread, 4);

    // Another kind is a 404 for the role (not a 403: the alert is not theirs to know about).
    const contact = rows.find((row) => row.kind === 'contact_message')!;
    assert.equal((await readOne(req('/api/alerts/' + contact._id + '/read', 'staff', 'POST'), { params: Promise.resolve({ id: contact._id }) })).status, 404);
    assert.equal(contact.readAt, null);
    assert.equal((await readOne(req('/api/alerts/' + contact._id + '/read', 'support', 'POST'), { params: Promise.resolve({ id: contact._id }) })).status, 200);
    assert.ok(contact.readAt === null || contact.readAt instanceof Date);

    // read-all marks only what the role sees: staff leave the return, review and contact alerts alone.
    for (const row of rows) row.readAt = null;
    const marked = (await (await readAll(req('/api/alerts/read-all', 'staff', 'POST'), {})).json()) as { marked: number; unread: number };
    assert.equal(marked.marked, 4);
    assert.deepEqual(rows.filter((row) => row.store === STORE_A && row.readAt !== null).map((row) => row.kind).sort(), ['low_stock', 'new_order', 'out_of_stock', 'unconfirmed_order']);
    assert.equal(rows.find((row) => row.store === STORE_B)!.readAt, null, 'another store is never touched');
  } finally {
    (SellerAlert as any).find = saved.find;
    (SellerAlert as any).countDocuments = saved.count;
    (SellerAlert as any).updateMany = saved.many;
    (SellerAlert as any).findOneAndUpdate = saved.one;
    (SellerAlert as any).findOne = saved.findOne;
  }
});

// ----------------------------------------------------------------------------------------------- what a role may read of the settings

const settings = (): any => ({
  id: STORE_A,
  slug: 'zara',
  status: 'active',
  profile: { name: 'Zara' },
  branding: { logo: null, banner: null },
  social: {},
  seo: {},
  delivery: { defaultRate: 250, freeOver: null, cityRates: [], estimate: null },
  payments: { codEnabled: false, cardEnabled: true, cardAvailable: true },
  payout: { method: 'bank', accountTitle: 'Zara', accountNumberMasked: '••••1234', bankName: 'HBL', updatedAt: null },
  theme: { activeTheme: 'stiletto', supportsCardCheckout: true },
  messages: { whatsappTemplate: 'Hi {customerName}', emailFooter: 'Zara Lawn', abandonedCartEmail: true },
  fraud: { codConfirmation: 'all', riskRules: { flaggedCities: ['Karachi'] } },
  returns: { returnWindowDays: 7 },
  domain: { redirectToCustomDomain: true },
  themeConfig: { primaryColor: '#111111' },
  tax: { enabled: true, ratePercent: 17, mode: 'exclusive', label: 'Tax' },
  updatedAt: null,
});

test('settings by role: the owner everything; a manager everything but the payout account; staff and support only the safe subset (no payment, fraud, payout, domain, message details)', () => {
  const full = settings();
  assert.deepEqual(settingsForRole(full, 'owner'), full);
  const manager = settingsForRole(full, 'manager');
  assert.equal(manager.payout, null);
  assert.deepEqual(manager.payments, full.payments);
  assert.deepEqual(manager.fraud, full.fraud);
  assert.deepEqual(manager.tax, full.tax, 'the Tax tab loads for a manager');
  for (const role of ['staff', 'support'] as const) {
    const safe = settingsForRole(full, role);
    assert.equal(safe.payout, null, role);
    assert.deepEqual(safe.payments, { codEnabled: true, cardEnabled: false, cardAvailable: false }, role);
    assert.notDeepEqual(safe.fraud, full.fraud, role);
    assert.equal(JSON.stringify(safe.fraud).includes('Karachi'), false, role);
    assert.deepEqual(safe.messages, { whatsappTemplate: null, emailFooter: null, abandonedCartEmail: false }, role);
    assert.equal('domain' in safe, false, role);
    assert.equal(JSON.stringify(safe).includes('1234'), false, role);
    assert.equal(JSON.stringify(safe).includes('HBL'), false, role);
    assert.equal(safe.delivery.defaultRate, 250, 'the store profile and delivery stay visible');
    assert.equal(safe.profile.name, 'Zara');
  }
  for (const role of [null, undefined, 'god'] as const) {
    const unknown = settingsForRole(full, role as never);
    assert.equal(unknown.payout, null);
    assert.equal(JSON.stringify(unknown.payments), JSON.stringify({ codEnabled: true, cardEnabled: false, cardAvailable: false }), String(role) + ': an unknown role gets the safe subset');
  }
});

test('the store document of GET /api/stores/:id holds no message templates for staff and support (the settings view already hides them)', () => {
  const doc = { name: 'Shop', storefront: { city: 'Lahore', whatsappTemplate: 'Dear {name}', emailFooter: 'Our footer' } };
  for (const role of ['owner', 'manager', null] as const) assert.deepEqual(storeDocForRole(doc, role), doc, String(role));
  for (const role of ['staff', 'support'] as const) assert.deepEqual(storeDocForRole(doc, role), { name: 'Shop', storefront: { city: 'Lahore' } }, role);
  const route = readFileSync(resolve(process.cwd(), 'src/app/api/stores/[id]/route.ts'), 'utf8');
  assert.match(route, /NextResponse\.json\(storeDocForRole\(/, 'the route answers through it');
});
