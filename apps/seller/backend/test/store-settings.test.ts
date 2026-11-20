import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Media, Order, PlatformSettingsModel, Product, signSession, Store, User } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { settleRevalidations } from '../src/lib/revalidate';
import { settleAdminCalls } from '../src/lib/admin-go-live';
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
  // Card only needs a theme with card checkout (SB-11); the default theme has none, so this store uses Stiletto. Sprint 5: and card has to be
  // available on the platform (the switch and Stripe), or COD cannot go off at all (see the NO_USABLE_PAYMENT_METHOD tests below).
  stores[STORE_A]!.storefront.activeTheme = 'stiletto';
  await withCardEnv(CARD_ON, async () => assert.equal((await save({ payments: { cardEnabled: true, codEnabled: false } })).status, 200));
});

type Body = { code?: string; field?: string; error?: string; errors?: Array<{ message: string }> };

test('SB-11: COD cannot go off while the theme has no card checkout (422 CARD_CHECKOUT_UNSUPPORTED_BY_THEME, payments.codEnabled)', async () => {
  // STORE_A has no theme set, so it renders with the default, Mustafa.
  const res = await save({ payments: { codEnabled: false, cardEnabled: true } });
  assert.equal(res.status, 422);
  const body = (await res.json()) as Body;
  assert.equal(body.code, 'CARD_CHECKOUT_UNSUPPORTED_BY_THEME');
  assert.equal(body.field, 'payments.codEnabled');
  assert.match(body.errors?.[0]?.message ?? '', /cannot take card payments/);
  assert.deepEqual(stores[STORE_A]!.paymentSettings, {}, 'nothing was written');
  stores[STORE_A]!.storefront.activeTheme = 'mustafa';
  assert.equal((await save({ payments: { codEnabled: false, cardEnabled: true } })).status, 422);
  // Switching the theme in the same request makes it fine (Sprint 5: while card is available on the platform).
  await withCardEnv(CARD_ON, async () =>
    assert.equal((await save({ theme: { activeTheme: 'stiletto' }, payments: { codEnabled: false, cardEnabled: true } })).status, 200),
  );
  assert.equal(stores[STORE_A]!.paymentSettings.codEnabled, false);
  assert.equal(stores[STORE_A]!.storefront.activeTheme, 'stiletto');
});

test('SB-11: COD stays switchable and card can be added on a theme without card checkout', async () => {
  assert.equal((await save({ payments: { codEnabled: true, cardEnabled: false } })).status, 200);
  assert.equal((await save({ payments: { codEnabled: true, cardEnabled: true } })).status, 200);
});

test('SB-11: a switch to a theme without card checkout is refused 422 while COD is off (theme.activeTheme)', async () => {
  stores[STORE_A]!.storefront.activeTheme = 'stiletto';
  stores[STORE_A]!.paymentSettings = { codEnabled: false, cardEnabled: true };
  const res = await save({ theme: { activeTheme: 'mustafa' } });
  assert.equal(res.status, 422);
  const body = (await res.json()) as Body;
  assert.equal(body.code, 'CARD_CHECKOUT_UNSUPPORTED_BY_THEME');
  assert.equal(body.field, 'theme.activeTheme');
  assert.equal(stores[STORE_A]!.storefront.activeTheme, 'stiletto', 'the theme is unchanged');
  // With COD on again the same switch works.
  assert.equal((await save({ payments: { codEnabled: true } })).status, 200);
  assert.equal((await save({ theme: { activeTheme: 'mustafa' } })).status, 200);
});

test('SB-11: a store already card only on Mustafa can still save the same theme (the rule stops new switches only)', async () => {
  stores[STORE_A]!.paymentSettings = { codEnabled: false, cardEnabled: true };
  assert.equal((await save({ theme: { activeTheme: 'mustafa' } })).status, 200);
  assert.equal((await save({ delivery: { defaultRate: 100 } })).status, 200);
});

test('SB-11: the settings and the theme list carry the flag; a theme without it counts as no card checkout', async () => {
  const read = await settingsGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A));
  assert.equal(((await read.json()) as { settings: any }).settings.theme.supportsCardCheckout, false);
  stores[STORE_A]!.storefront.activeTheme = 'stiletto';
  const again = await settingsGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A));
  assert.equal(((await again.json()) as { settings: any }).settings.theme.supportsCardCheckout, true);

  const list = await (await import('../src/app/api/themes/route')).GET(
    new NextRequest('http://seller.test/api/themes', { headers: { authorization: 'Bearer ' + tokenA } }),
  );
  assert.equal(list.status, 200);
  const { themes } = (await list.json()) as { themes: Array<{ slug: string; supportsCardCheckout: boolean }> };
  assert.equal(themes.find((t) => t.slug === 'stiletto')?.supportsCardCheckout, true);
  assert.equal(themes.find((t) => t.slug === 'mustafa')?.supportsCardCheckout, false);
  assert.ok(themes.every((t) => typeof t.supportsCardCheckout === 'boolean'));
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

test('a wallet payout can be sent without a bank name (found by the Sprint 4 verification)', async () => {
  const res = await save({ payout: { method: 'easypaisa', accountTitle: 'Zara', accountNumber: '03451234567' } });
  assert.equal(res.status, 200);
  const { settings } = (await res.json()) as { settings: any };
  assert.equal(settings.payout.method, 'easypaisa');
  assert.equal(settings.payout.bankName, null);
  assert.equal(settings.payout.accountNumberMasked, '••••4567');
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

// Sprint 5 EP-11.US04.T03: when every published product has nothing to buy, the checklist WARNS and never blocks.
test('Sprint 5: a store whose published products are all out of stock gets a stock warning, still ready, and can go live', async () => {
  complete();
  ProductModel.exists = async (filter: any) => (filter.variants?.$elemMatch ? null : { _id: 'p' });
  const result = (await readiness()) as { ready: boolean; missing: string[]; warnings?: Array<{ key: string; label: string; tab: string }> };
  assert.equal(result.ready, true, 'a warning is not a blocker');
  assert.deepEqual(result.missing, []);
  assert.equal(result.warnings?.length, 1);
  assert.equal(result.warnings?.[0]?.key, 'stock');
  assert.equal(result.warnings?.[0]?.tab, 'inventory');
  assert.match(result.warnings?.[0]?.label ?? '', /out of stock/i);
  assert.equal((await goLive()).status, 200);
  assert.equal(stores[STORE_A]!.status, 'active');
});

test('Sprint 5: the buyable test is the storefront rule (no tracking, or stock above 0), and a store with stock has no warnings field', async () => {
  complete();
  let seen: any = null;
  ProductModel.exists = async (filter: any) => {
    if (filter.variants?.$elemMatch) seen = filter.variants.$elemMatch;
    return { _id: 'p' };
  };
  const result = (await readiness()) as { ready: boolean; warnings?: unknown };
  assert.equal(result.ready, true);
  assert.equal('warnings' in result, false);
  assert.deepEqual(seen, { $or: [{ trackQuantity: false }, { stockQuantity: { $gt: 0 } }] });
});

test('Sprint 5: with no published product at all there is the product item to fix, and no stock warning on top', async () => {
  complete();
  publishedProduct = false;
  const result = (await readiness()) as { missing: string[]; warnings?: unknown };
  assert.deepEqual(result.missing, ['product']);
  assert.equal('warnings' in result, false);
});

// Sprint 5 EP-11.US04.T01 (D-107): COD-only mode in the settings answer and the checklist.
const CARD_ENV = ['CARD_CHECKOUT_ENABLED', 'STRIPE_SECRET_KEY', 'STRIPE_ORDER_WEBHOOK_SECRET'] as const;
/** The platform offers card: the switch is on and Stripe is configured (STOREFRONT_URL is set by every test). */
const CARD_ON = { STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_ORDER_WEBHOOK_SECRET: 'whsec_stub', CARD_CHECKOUT_ENABLED: 'true' } as const;
async function withCardEnv(values: Partial<Record<(typeof CARD_ENV)[number], string>>, run: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(CARD_ENV.map((key) => [key, process.env[key]]));
  for (const key of CARD_ENV) delete process.env[key];
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const key of CARD_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}
const cardAvailable = async () => ((await (await settingsGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A))).json()) as { settings: any }).settings.payments.cardAvailable;

test('Sprint 5: the settings answer reports cardAvailable false while CARD_CHECKOUT_ENABLED is off, even with every Stripe value set', async () => {
  const stripe = { STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_ORDER_WEBHOOK_SECRET: 'whsec_stub' };
  await withCardEnv({}, async () => assert.equal(await cardAvailable(), false));
  await withCardEnv({ ...stripe }, async () => assert.equal(await cardAvailable(), false, 'keys alone do not turn card on'));
  await withCardEnv({ ...stripe, CARD_CHECKOUT_ENABLED: 'false' }, async () => assert.equal(await cardAvailable(), false));
  await withCardEnv({ CARD_CHECKOUT_ENABLED: 'true' }, async () => assert.equal(await cardAvailable(), false, 'the switch alone is not enough without Stripe'));
  await withCardEnv({ ...stripe, CARD_CHECKOUT_ENABLED: 'true' }, async () => assert.equal(await cardAvailable(), true));
});

test('Sprint 5: a store that is card only does not pass the payment check while card is off, and does when the platform offers card', async () => {
  complete();
  stores[STORE_A]!.paymentSettings = { codEnabled: false, cardEnabled: true };
  await withCardEnv({}, async () => assert.ok(((await readiness()) as { missing: string[] }).missing.includes('payment')));
  await withCardEnv({ STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_ORDER_WEBHOOK_SECRET: 'whsec_stub', CARD_CHECKOUT_ENABLED: 'true' }, async () =>
    assert.equal(((await readiness()) as { missing: string[] }).missing.includes('payment'), false),
  );
  stores[STORE_A]!.paymentSettings = { codEnabled: true, cardEnabled: false };
  await withCardEnv({}, async () => assert.equal(((await readiness()) as { missing: string[] }).missing.includes('payment'), false, 'COD alone is a payment method'));
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

// D-098 A2: the admin backend is told once, and a failure never fails go-live.
const ADMIN_PATH = '/api/internal/stores/go-live';
const withAdminBridge = (): (() => void) => {
  process.env.ADMIN_BACKEND_API_URL = 'http://admin.test';
  process.env.SYNC_KEY_ID_CURRENT = 'k-test';
  process.env.SYNC_SECRET_CURRENT = 'y'.repeat(40);
  return () => {
    delete process.env.ADMIN_BACKEND_API_URL;
    delete process.env.SYNC_KEY_ID_CURRENT;
    delete process.env.SYNC_SECRET_CURRENT;
  };
};

test('go-live tells the admin backend once; a repeat go-live is a no-op and does not call again', async () => {
  const done = withAdminBridge();
  try {
    complete();
    assert.equal((await goLive()).status, 200);
    await settleAdminCalls();
    assert.equal(purges.filter((url) => url.includes(ADMIN_PATH)).length, 1);
    const again = await goLive();
    assert.equal(again.status, 200);
    await settleAdminCalls();
    assert.equal(purges.filter((url) => url.includes(ADMIN_PATH)).length, 1);
    assert.equal(stores[STORE_A]!.status, 'active');
  } finally {
    done();
  }
});

test('an approval request is reported to the admin backend as pending', async () => {
  const done = withAdminBridge();
  const original = globalThis.fetch;
  let sent: { body: any; headers: Record<string, string> } | null = null;
  globalThis.fetch = (async (url: string, init: any) => {
    if (String(url).includes(ADMIN_PATH)) sent = { body: JSON.parse(init.body), headers: init.headers };
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    complete();
    approvalRequired = true;
    await goLive();
    await settleAdminCalls();
    assert.ok(sent);
    assert.equal(sent!.body.status, 'pending');
    assert.equal(sent!.body.storeId, STORE_A);
    assert.ok(sent!.headers['x-sync-signature']);
  } finally {
    globalThis.fetch = original;
    done();
  }
});

test('a failing admin call does not fail go-live', async () => {
  const done = withAdminBridge();
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes(ADMIN_PATH)) throw new Error('connect ECONNREFUSED');
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const log = console.error;
  console.error = () => {};
  try {
    complete();
    const res = await goLive();
    await settleAdminCalls();
    assert.equal(res.status, 200);
    assert.equal(stores[STORE_A]!.status, 'active');
  } finally {
    console.error = log;
    globalThis.fetch = original;
    done();
  }
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

// --------------------------------------------------------------------------------- message overrides (SB-8, EP-07.US02.T02)

test('the WhatsApp text and the email footer are saved in the messages group, read back, and cleared with an empty string', async () => {
  const res = await save({ messages: { whatsappTemplate: 'Hi {customerName}, order {orderNumber} from {storeName}: {trackingLink}', emailFooter: 'Questions? Call 0300 1234567.' } });
  assert.equal(res.status, 200);
  const { settings } = (await res.json()) as { settings: any };
  assert.deepEqual(settings.messages, { whatsappTemplate: 'Hi {customerName}, order {orderNumber} from {storeName}: {trackingLink}', emailFooter: 'Questions? Call 0300 1234567.' });
  assert.equal(stores[STORE_A]!.storefront.whatsappTemplate, 'Hi {customerName}, order {orderNumber} from {storeName}: {trackingLink}');
  assert.equal(stores[STORE_A]!.storefront.deliveryRate, 250, 'the other storefront keys are kept');

  const read = await settingsGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A));
  assert.equal(((await read.json()) as { settings: any }).settings.messages.emailFooter, 'Questions? Call 0300 1234567.');

  const cleared = await save({ messages: { whatsappTemplate: '' } });
  assert.equal(((await cleared.json()) as { settings: any }).settings.messages.whatsappTemplate, null);
  assert.equal(stores[STORE_A]!.storefront.emailFooter, 'Questions? Call 0300 1234567.', 'only the named field was cleared');
});

test('a WhatsApp text with a variable that does not exist is a 400 naming the field; so are too long and HTML', async () => {
  assert.equal(await fieldOf(await save({ messages: { whatsappTemplate: 'Hi {customerName}, your {parcelColour} is ready' } })), 'messages.whatsappTemplate');
  assert.equal(await fieldOf(await save({ messages: { whatsappTemplate: 'x'.repeat(501) } })), 'messages.whatsappTemplate');
  assert.equal(await fieldOf(await save({ messages: { whatsappTemplate: 'Hi <b>there</b>' } })), 'messages.whatsappTemplate');
  assert.equal(await fieldOf(await save({ messages: { emailFooter: 'x'.repeat(301) } })), 'messages.emailFooter');
  assert.equal(await fieldOf(await save({ messages: { emailFooter: '<script>x</script>' } })), 'messages.emailFooter');
  assert.equal((await save({ messages: { whatsappTemplate: 'x'.repeat(500), emailFooter: 'y'.repeat(300) } })).status, 200);
  assert.equal(stores[STORE_A]!.storefront.whatsappTemplate, 'x'.repeat(500));
});

test('the messages group is for the owner only: Seller B and an admin cannot change it', async () => {
  assert.equal((await save({ messages: { emailFooter: 'Hacked' } }, tokenB)).status, 403);
  assert.equal((await save({ messages: { emailFooter: 'Hacked' } }, tokenAdmin)).status, 403);
  assert.equal(stores[STORE_A]!.storefront.emailFooter, undefined);
});


// ---------------------------------------------------------------------------------------------------------------------
// Sprint 5 (D-107, SB-1 follow-up): COD cannot go off while card is not available

test('Sprint 5: COD cannot go off while card is not available: 422 NO_USABLE_PAYMENT_METHOD on payments, and nothing is written', async () => {
  stores[STORE_A]!.storefront.activeTheme = 'stiletto';
  const stripe = { STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_ORDER_WEBHOOK_SECRET: 'whsec_stub' };
  // Platform switch off (the default), the switch on without Stripe, and Stripe keys without the switch: card is not available in any of them.
  for (const env of [{}, { CARD_CHECKOUT_ENABLED: 'true' }, { ...stripe }, { ...stripe, CARD_CHECKOUT_ENABLED: 'false' }]) {
    await withCardEnv(env, async () => {
      for (const payments of [{ codEnabled: false, cardEnabled: true }, { codEnabled: false }]) {
        const res = await save({ payments });
        assert.equal(res.status, 422, JSON.stringify(env) + JSON.stringify(payments));
        const body = (await res.json()) as Body;
        assert.equal(body.code, 'NO_USABLE_PAYMENT_METHOD');
        assert.equal(body.field, 'payments');
        assert.match(body.errors?.[0]?.message ?? '', /Cash on delivery has to stay on/);
      }
    });
  }
  assert.deepEqual(stores[STORE_A]!.paymentSettings, {}, 'nothing was written');
  assert.equal(audits.length, 0);
});

test('Sprint 5: COD may go off when card is available, and COD only is always fine', async () => {
  stores[STORE_A]!.storefront.activeTheme = 'stiletto';
  await withCardEnv({}, async () => {
    assert.equal((await save({ payments: { codEnabled: true, cardEnabled: false } })).status, 200);
    assert.equal((await save({ payments: { codEnabled: true, cardEnabled: true } })).status, 200);
  });
  await withCardEnv(CARD_ON, async () => {
    assert.equal((await save({ payments: { codEnabled: false, cardEnabled: true } })).status, 200);
    assert.equal(stores[STORE_A]!.paymentSettings.codEnabled, false);
  });
});

test('Sprint 5: the old "keep one method on" 400 stays first, and the theme rule keeps its own 422 on a theme without card checkout', async () => {
  await withCardEnv({}, async () => {
    const both = await save({ payments: { codEnabled: false, cardEnabled: false } });
    assert.equal(both.status, 400);
    assert.equal(await fieldOf(both), 'payments.codEnabled');
    // The default theme cannot take card, so the more specific SB-11 answer wins.
    const theme = await save({ payments: { codEnabled: false, cardEnabled: true } });
    assert.equal(theme.status, 422);
    assert.equal(((await theme.json()) as Body).code, 'CARD_CHECKOUT_UNSUPPORTED_BY_THEME');
  });
});

test('Sprint 5: the rule judges a payments change only: a store already without a usable method can still save its profile', async () => {
  stores[STORE_A]!.paymentSettings = { codEnabled: false, cardEnabled: true };
  stores[STORE_A]!.storefront.activeTheme = 'stiletto';
  await withCardEnv({}, async () => {
    assert.equal((await save({ profile: { city: 'Lahore' } })).status, 200);
    assert.equal((await save({ payments: { codEnabled: true } })).status, 200);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 5 EP-11.US01.T01 and US03.T01 (D-107): the 'fraud' group

const readFraudSettings = async () => ((await (await settingsGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A))).json()) as { settings: any }).settings.fraud;

const THIRTY_CITIES = [
  'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Hyderabad', 'Gujranwala',
  'Sialkot', 'Sargodha', 'Bahawalpur', 'Sukkur', 'Larkana', 'Sheikhupura', 'Rahim Yar Khan', 'Jhang', 'Dera Ghazi Khan', 'Gujrat',
  'Sahiwal', 'Wah Cantt', 'Mardan', 'Kasur', 'Okara', 'Mingora', 'Nawabshah', 'Chiniot', 'Kotri', 'Kamoke',
];

test('fraud: a store that never saved the group reads mode off and no rules', async () => {
  assert.deepEqual(await readFraudSettings(), { codConfirmation: 'off', riskRules: { flagOrderValueAbove: null, flaggedCities: [], flagReturnsAtLeast: null } });
});

test('fraud: the mode and the rules are saved in paymentSettings (never in storefront), audited by group and field, and read back', async () => {
  const res = await save({
    fraud: { codConfirmation: 'flagged', riskRules: { flagOrderValueAbove: 15000, flaggedCities: ['karachi', 'Quetta'], flagReturnsAtLeast: 2 } },
  });
  assert.equal(res.status, 200);
  const settings = ((await res.json()) as { settings: any }).settings;
  assert.deepEqual(settings.fraud, {
    codConfirmation: 'flagged',
    riskRules: { flagOrderValueAbove: 15000, flaggedCities: ['Karachi', 'Quetta'], flagReturnsAtLeast: 2 },
  });
  assert.equal(stores[STORE_A]!.paymentSettings.fraud.codConfirmation, 'flagged');
  assert.equal('fraud' in stores[STORE_A]!.storefront, false, 'the public storefront reads storefront, so the rules are not kept there');
  assert.equal(JSON.stringify(stores[STORE_A]!.storefront).includes('Quetta'), false);
  assert.deepEqual(await readFraudSettings(), settings.fraud);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0]!.details.groups, ['fraud']);
  assert.deepEqual(audits[0]!.details.fields, ['paymentSettings']);
});

test('fraud: only the fields sent change; null clears a rule; the payment switches saved before are kept', async () => {
  stores[STORE_A]!.paymentSettings = { codEnabled: true, cardEnabled: false };
  await save({ fraud: { codConfirmation: 'all', riskRules: { flagOrderValueAbove: 9000, flaggedCities: ['Lahore'], flagReturnsAtLeast: 3 } } });
  await save({ fraud: { riskRules: { flagOrderValueAbove: null } } });
  assert.deepEqual(await readFraudSettings(), {
    codConfirmation: 'all',
    riskRules: { flagOrderValueAbove: null, flaggedCities: ['Lahore'], flagReturnsAtLeast: 3 },
  });
  await save({ fraud: { codConfirmation: 'off' } });
  assert.equal((await readFraudSettings()).codConfirmation, 'off');
  assert.equal((await readFraudSettings()).riskRules.flaggedCities.length, 1, 'the rules stay while the mode is off');
  assert.equal(stores[STORE_A]!.paymentSettings.codEnabled, true);
  assert.equal(stores[STORE_A]!.paymentSettings.cardEnabled, false);
});

test('fraud: a payments save keeps the saved fraud group', async () => {
  await save({ fraud: { codConfirmation: 'flagged' } });
  await save({ payments: { codEnabled: true, cardEnabled: false } });
  assert.equal((await readFraudSettings()).codConfirmation, 'flagged');
});

test('fraud: bad values are 400 and name the field; nothing is written', async () => {
  const cases: Array<[unknown, string]> = [
    [{ codConfirmation: 'sometimes' }, 'fraud.codConfirmation'],
    [{ riskRules: { flagOrderValueAbove: 0 } }, 'fraud.riskRules.flagOrderValueAbove'],
    [{ riskRules: { flagOrderValueAbove: -5 } }, 'fraud.riskRules.flagOrderValueAbove'],
    [{ riskRules: { flagOrderValueAbove: 1500.5 } }, 'fraud.riskRules.flagOrderValueAbove'],
    [{ riskRules: { flagOrderValueAbove: '15000' } }, 'fraud.riskRules.flagOrderValueAbove'],
    [{ riskRules: { flagReturnsAtLeast: 0 } }, 'fraud.riskRules.flagReturnsAtLeast'],
    [{ riskRules: { flagReturnsAtLeast: 11 } }, 'fraud.riskRules.flagReturnsAtLeast'],
    [{ riskRules: { flagReturnsAtLeast: 2.5 } }, 'fraud.riskRules.flagReturnsAtLeast'],
    [{ riskRules: { flaggedCities: ['Atlantis'] } }, 'fraud.riskRules.flaggedCities.0'],
    [{ riskRules: { flaggedCities: ['Karachi', 'karachi'] } }, 'fraud.riskRules.flaggedCities'],
    [{ riskRules: { flaggedCities: [...THIRTY_CITIES, 'Hafizabad'] } }, 'fraud.riskRules.flaggedCities'],
    [{ banana: true }, 'banana'],
    [{ riskRules: { banana: 1 } }, 'banana'],
  ];
  for (const [fraud, field] of cases) {
    const res = await save({ fraud });
    assert.equal(res.status, 400, JSON.stringify(fraud).slice(0, 80));
    assert.equal(await fieldOf(res), field, JSON.stringify(fraud).slice(0, 80));
  }
  assert.deepEqual(stores[STORE_A]!.paymentSettings, {});
  assert.equal(audits.length, 0);
});

test('fraud: 30 cities are accepted, and so are the edges of the order value and the returns count', async () => {
  const res = await save({ fraud: { riskRules: { flaggedCities: THIRTY_CITIES, flagOrderValueAbove: 1, flagReturnsAtLeast: 10 } } });
  assert.equal(res.status, 200);
  assert.equal((await readFraudSettings()).riskRules.flaggedCities.length, 30);
});

test("fraud: Seller B cannot change Seller A's fraud settings and an admin session is refused", async () => {
  assert.equal((await save({ fraud: { codConfirmation: 'all' } }, tokenB)).status, 403);
  assert.equal((await save({ fraud: { codConfirmation: 'all' } }, tokenAdmin)).status, 403);
  assert.equal((await readFraudSettings()).codConfirmation, 'off');
});
