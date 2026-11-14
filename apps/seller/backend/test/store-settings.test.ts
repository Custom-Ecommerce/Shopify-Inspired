import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Media, Order, PlatformSettingsModel, Product, signSession, Store, User } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { settleRevalidations } from '../src/lib/revalidate';
import { newStoreStatus } from '../src/lib/workspace';
import { computeTotals, priceCart } from '../src/lib/storefront/pricing';

// Sprint 4 EP-04 (D-094, D-088, D-095): PATCH /api/stores/:id, GET .../settings, readiness, go-live, and the delivery
// pricing. Models are stubbed; no database. The storefront purge is observed through a stubbed fetch.

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const LOGO = '65a0000000000000000c0001';
const FOREIGN_MEDIA = '65a0000000000000000c0002';
const T0 = new Date('2026-11-14T10:00:00Z');

const StoreModel = Store as any;
const MediaModel = Media as any;
const ProductModel = Product as any;
const AuditModel = AuditLog as any;
const SettingsModel = PlatformSettingsModel as any;
const UserModel = User as any;
const OrderModel = Order as any;

let stores: Record<string, Record<string, any>>;
let audits: Array<Record<string, any>> = [];
let purges: string[] = [];
let publishedProduct = true;
let approvalRequired = false;
let emailVerified = true;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};
let patch: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let settingsGET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let readinessGET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let goLivePOST: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  patch = (await import('../src/app/api/stores/[id]/route')).PATCH;
  settingsGET = (await import('../src/app/api/stores/[id]/settings/route')).GET;
  readinessGET = (await import('../src/app/api/stores/[id]/readiness/route')).GET;
  goLivePOST = (await import('../src/app/api/stores/[id]/go-live/route')).POST;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value() };
  return q;
};
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : String(a) === String(b));

beforeEach(() => {
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, slug: 'zara', name: 'Zara Lawn', status: 'pending', storefront: { deliveryRate: 250 }, paymentSettings: {}, updatedAt: T0 },
    [STORE_B]: { _id: STORE_B, owner: USER_B, slug: 'bilal', name: 'Bilal Shoes', status: 'pending', storefront: {}, paymentSettings: {}, updatedAt: T0 },
  };
  audits = [];
  purges = [];
  publishedProduct = true;
  approvalRequired = false;
  emailVerified = true;
  process.env.STOREFRONT_URL = 'https://markazify.com';
  process.env.REVALIDATE_SECRET = 'r'.repeat(40);
  const saved = {
    connect: (mongoose as any).connect,
    fetch: globalThis.fetch,
    store: Object.fromEntries(['findOne', 'findOneAndUpdate', 'exists', 'findById'].map((m) => [m, StoreModel[m]])),
    media: Object.fromEntries(['exists', 'findOne'].map((m) => [m, MediaModel[m]])),
    product: Object.fromEntries(['exists', 'countDocuments'].map((m) => [m, ProductModel[m]])),
    audit: AuditModel.create,
    settings: SettingsModel.findOne,
    user: UserModel.findById,
    order: OrderModel.updateMany,
  };
  (mongoose as any).connect = async () => mongoose;
  globalThis.fetch = (async (url: string) => {
    purges.push(String(url));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  StoreModel.findOne = (filter: any) =>
    chain(() => {
      const row = stores[String(filter._id)];
      if (!row || (filter.owner !== undefined && !same(row.owner, filter.owner))) return null;
      return structuredClone(row);
    });
  StoreModel.exists = async (filter: any) => (stores[String(filter._id)] && same(stores[String(filter._id)]!.owner, filter.owner) ? { _id: filter._id } : null);
  StoreModel.findById = (id: unknown) => chain(() => (stores[String(id)] ? { slug: stores[String(id)]!.slug } : null));
  StoreModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = stores[String(filter._id)];
      if (!row || !same(row.owner, filter.owner)) return null;
      if ('updatedAt' in filter && !same(row.updatedAt, filter.updatedAt)) return null;
      if ('status' in filter && row.status !== filter.status) return null;
      Object.assign(row, structuredClone(update.$set ?? {}));
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      return structuredClone(row);
    });
  MediaModel.exists = async (filter: any) => (String(filter._id) === LOGO && String(filter.store) === STORE_A ? { _id: LOGO } : null);
  MediaModel.findOne = (filter: any) => chain(() => (String(filter._id) === LOGO ? { url: 'https://res.cloudinary.com/x/logo.png' } : null));
  ProductModel.exists = async () => (publishedProduct ? { _id: 'p' } : null);
  ProductModel.countDocuments = async () => 0;
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  SettingsModel.findOne = () => chain(() => ({ storeApprovalRequired: approvalRequired }));
  UserModel.findById = () => chain(() => ({ emailVerifiedAt: emailVerified ? T0 : null }));
  OrderModel.updateMany = () => {
    throw new Error('a store settings save must never touch an order');
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    globalThis.fetch = saved.fetch;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.media)) MediaModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.product)) ProductModel[m] = fn;
    AuditModel.create = saved.audit;
    SettingsModel.findOne = saved.settings;
    UserModel.findById = saved.user;
    OrderModel.updateMany = saved.order;
    delete process.env.STOREFRONT_URL;
    delete process.env.REVALIDATE_SECRET;
  };
});

afterEach(() => restore());

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string, token: string, body?: unknown, method = 'PATCH') =>
  new NextRequest('http://seller.test/api/stores/' + id, {
    method,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const save = (body: unknown, token = tokenA, id = STORE_A) => patch(req(id, token, body), params(id));
const fieldOf = async (res: Response) => ((await res.json()) as { field?: string }).field;

// ------------------------------------------------------------------------------------------------------- PATCH

test('a save is stored, read back in the settings shape, and purges the storefront exactly once', async () => {
  const res = await save({
    profile: { name: '  Zara   Lawn House ', contactPhone: '0300 1234567', city: 'Lahore', description: 'Lawn and chiffon.\nNew stock weekly.' },
    delivery: { defaultRate: 200, freeOver: 5000, cityRates: [{ city: 'karachi', rate: 300 }], estimate: '2 to 4 days' },
    branding: { logo: LOGO },
    social: { instagram: 'https://www.instagram.com/zaralawn' },
  });
  assert.equal(res.status, 200);
  const { settings } = (await res.json()) as { settings: any };
  assert.equal(settings.profile.name, 'Zara Lawn House');
  assert.equal(settings.profile.contactPhone, '+923001234567');
  assert.deepEqual(settings.delivery, { defaultRate: 200, freeOver: 5000, cityRates: [{ city: 'Karachi', rate: 300 }], estimate: '2 to 4 days' });
  assert.deepEqual(settings.branding.logo, { id: LOGO, url: 'https://res.cloudinary.com/x/logo.png' });
  assert.equal(settings.social.instagram, 'https://www.instagram.com/zaralawn');
  assert.equal(stores[STORE_A]!.storefront.deliveryRate, 200);
  assert.equal(stores[STORE_A]!.slug, 'zara');

  await settleRevalidations();
  assert.equal(purges.filter((url) => url.includes('/api/revalidate')).length, 1);
  assert.equal(audits[0]!.action, 'store.settings');

  const read = await settingsGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A));
  assert.deepEqual(((await read.json()) as { settings: any }).settings.delivery, settings.delivery);
});

test('invalid input is a 400 that names the field; HTML is refused', async () => {
  assert.equal(await fieldOf(await save({ delivery: { defaultRate: -1 } })), 'delivery.defaultRate');
  assert.equal(await fieldOf(await save({ delivery: { defaultRate: 99.5 } })), 'delivery.defaultRate');
  assert.equal(await fieldOf(await save({ profile: { contactPhone: '12345' } })), 'profile.contactPhone');
  assert.equal(await fieldOf(await save({ profile: { description: '<script>x</script>' } })), 'profile.description');
  assert.equal(await fieldOf(await save({ delivery: { cityRates: [{ city: 'Atlantis', rate: 100 }] } })), 'delivery.cityRates.0.city');
  assert.equal(await fieldOf(await save({ social: { facebook: 'http://evil.example.com' } })), 'social.facebook');
  assert.equal(stores[STORE_A]!.storefront.deliveryRate, 250, 'nothing was written');
});

test('the slug cannot change: sending it is a 400 naming "slug"', async () => {
  const res = await save({ slug: 'new-slug', profile: { name: 'Zara' } });
  assert.equal(res.status, 400);
  assert.equal(await fieldOf(res), 'slug');
  assert.equal(stores[STORE_A]!.slug, 'zara');
});

test('an admin session and Seller B are refused, and the store is unchanged', async () => {
  assert.equal((await save({ profile: { name: 'Taken over' } }, tokenAdmin)).status, 403);
  assert.equal((await save({ profile: { name: 'Taken over' } }, tokenB)).status, 403);
  assert.equal(stores[STORE_A]!.name, 'Zara Lawn');
  assert.equal((await settingsGET(req(STORE_A, tokenB, undefined, 'GET'), params(STORE_A))).status, 403);
});

test('the last payment method cannot be switched off', async () => {
  assert.equal(await fieldOf(await save({ payments: { codEnabled: false, cardEnabled: false } })), 'payments.codEnabled');
  stores[STORE_A]!.paymentSettings = { cardEnabled: false };
  const res = await save({ payments: { codEnabled: false } });
  assert.equal(res.status, 400);
  assert.equal(await fieldOf(res), 'payments.codEnabled');
  assert.equal((await save({ payments: { cardEnabled: true, codEnabled: false } })).status, 200);
});

test('payout details are shown masked and audited without the account number', async () => {
  const res = await save({ payout: { method: 'bank', accountTitle: 'Zara Lawn', accountNumber: 'PK36 SCBL 0000 0011 2345 6702', bankName: 'Standard Chartered' } });
  assert.equal(res.status, 200);
  const { settings } = (await res.json()) as { settings: any };
  assert.equal(settings.payout.accountNumberMasked, '••••6702');
  assert.equal(JSON.stringify(settings).includes('SCBL0000001123456702'), false);
  assert.equal(JSON.stringify(audits).includes('SCBL'), false, 'the audit never holds the number');
  assert.deepEqual(audits[0]!.details.payout, { method: 'bank', last4: '6702' });
  assert.equal(await fieldOf(await save({ payout: { method: 'jazzcash', accountTitle: 'Zara', accountNumber: '12345678', bankName: null } })), 'payout.accountNumber');
  assert.equal(await fieldOf(await save({ payout: { method: 'bank', accountTitle: 'Zara', accountNumber: 'PK36SCBL0000001123456702' } })), 'payout.bankName');
});

test('only an installed theme can be chosen; media must belong to the store', async () => {
  assert.equal(await fieldOf(await save({ theme: { activeTheme: 'mola' } })), 'theme.activeTheme');
  assert.equal((await save({ theme: { activeTheme: 'stiletto' } })).status, 200);
  assert.equal(stores[STORE_A]!.storefront.activeTheme, 'stiletto');
  assert.equal(await fieldOf(await save({ branding: { banner: FOREIGN_MEDIA } })), 'branding.banner');
});

test('a save on a stale copy loses with 409 and writes nothing', async () => {
  const realFind = StoreModel.findOne;
  StoreModel.findOne = (filter: any) => chain(async () => ({ ...(await realFind(filter).lean()), updatedAt: new Date(0) }));
  const res = await save({ profile: { name: 'Lost race' } });
  assert.equal(res.status, 409);
  assert.equal(stores[STORE_A]!.name, 'Zara Lawn');
});

// ------------------------------------------------------------------------------------------- readiness and go-live

const readiness = async () => (await (await readinessGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A))).json()) as { ready: boolean; missing: string[] };
const goLive = () => goLivePOST(req(STORE_A, tokenA, undefined, 'POST'), params(STORE_A));
const complete = () => {
  stores[STORE_A]!.storefront = { deliveryRate: 0, contactPhone: '+923001234567', city: 'Lahore' };
  stores[STORE_A]!.payoutDetails = { method: 'easypaisa', accountTitle: 'Zara', accountNumber: '03001234567', bankName: null };
};

test('readiness lists every missing item', async () => {
  stores[STORE_A]!.storefront = {};
  publishedProduct = false;
  emailVerified = false;
  const result = await readiness();
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['profile', 'delivery', 'payout', 'product', 'email']);
});

test('go-live is refused with 422 and the missing items until the checklist passes', async () => {
  publishedProduct = false;
  const res = await goLive();
  assert.equal(res.status, 422);
  const body = (await res.json()) as { code: string; missing: string[] };
  assert.equal(body.code, 'STORE_NOT_READY');
  assert.ok(body.missing.includes('product'));
  assert.equal(stores[STORE_A]!.status, 'pending');
});

test('go-live without approval required makes the store active at once and purges the storefront', async () => {
  complete();
  const res = await goLive();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'active', waitingForApproval: false, message: 'Your store is live.' });
  assert.equal(stores[STORE_A]!.status, 'active');
  await settleRevalidations();
  assert.ok(purges.some((url) => url.includes('/api/revalidate')));
});

test('go-live with approval required keeps the store pending and says it waits for approval', async () => {
  complete();
  approvalRequired = true;
  const res = await goLive();
  const body = (await res.json()) as { status: string; waitingForApproval: boolean };
  assert.deepEqual([body.status, body.waitingForApproval], ['pending', true]);
  assert.equal(stores[STORE_A]!.status, 'pending');
  assert.ok(stores[STORE_A]!.goLiveRequestedAt instanceof Date);
});

test('a new store starts pending in every environment (CO-26)', () => {
  const saved = process.env.NODE_ENV;
  for (const env of ['development', 'production', undefined]) {
    if (env === undefined) delete process.env.NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = env;
    assert.equal(newStoreStatus(), 'pending');
  }
  if (saved === undefined) delete process.env.NODE_ENV;
  else (process.env as Record<string, string>).NODE_ENV = saved;
});

// --------------------------------------------------------------------------------------------------- delivery pricing

const store = { deliveryRate: 250, freeDeliveryThreshold: 5000, cityRates: { karachi: 400, 'dera ghazi khan': 600 } };
const line = (unitPrice: number) => ({ unitPrice, qty: 1, deliveryCharge: null });

test('a city override beats the default; an unlisted or missing city pays the default; the city is matched loosely', () => {
  assert.equal(computeTotals([line(1000)], { ...store, city: 'Karachi' }).deliveryCharges, 400);
  assert.equal(computeTotals([line(1000)], { ...store, city: '  dera  ghazi khan ' }).deliveryCharges, 600);
  assert.equal(computeTotals([line(1000)], { ...store, city: 'Multan' }).deliveryCharges, 250);
  assert.equal(computeTotals([line(1000)], { ...store, city: null }).deliveryCharges, 250);
  assert.equal(computeTotals([{ ...line(1000), deliveryCharge: 100 }], { ...store, city: 'Karachi' }).deliveryCharges, 100, "a product's own charge still wins");
});

test('the free-delivery threshold is judged on the item subtotal after the discount', () => {
  const rule = { _id: 'd1', code: 'HALF', type: 'percentage', value: 50, isActive: true };
  const priced = priceCart([line(6000)], { ...store, city: 'Karachi' }, { code: 'HALF', rule }, T0);
  assert.equal(priced.totals.discount, 3000);
  assert.equal(priced.totals.deliveryCharges, 400, 'after the discount 3000 is below 5000');
  assert.equal(priceCart([line(6000)], store, null, T0).totals.deliveryCharges, 0, 'without the code 6000 is over the line');
});

test('a rate change never changes an old order: the order keeps its own delivery amount', () => {
  const order = { deliveryCharges: computeTotals([line(1000)], store).deliveryCharges };
  const later = computeTotals([line(1000)], { ...store, deliveryRate: 999 });
  assert.equal(order.deliveryCharges, 250);
  assert.equal(later.deliveryCharges, 999);
});
