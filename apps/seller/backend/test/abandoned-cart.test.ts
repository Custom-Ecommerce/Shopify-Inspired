import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { PREVIEW_CREDENTIAL_HEADER } from '@markaz/platform-kit/preview';
import { signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { markCartRecovered } from '@/lib/abandoned-carts';
import { queueAbandonedCartEmails } from '@/lib/abandoned-cart-email';
import { phoneKeyOf } from '@/lib/storefront/order-phone';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';
import { ADMIN, PHONE, SECRET, STORE_A, STORE_B, USER_A, USER_B, V1, V2, type Row } from './helpers/returns-world';
import { PRODUCT_P1, PRODUCT_P2, installReviewsWorld, type ReviewsWorld } from './helpers/reviews-world';

// Sprint 5 EP-28.US01.T02 to T06 (D-107): abandoned carts. The public PUT keeps ONE open cart per store and phone for 7 days, only with a valid
// phone AND the consent, priced by the server from the product ids; an order with the same phone key recovers it; the seller lists, marks
// contacted and deletes (own store only); the optional email is off by default, goes once, never to an unsubscribed address, and is escaped.
// Models are in memory (./helpers/reviews-world).

const DAY = 86_400_000;
const HOUR = 3_600_000;
const FIRST_ORDER = '65a0000000000000000a00aa';

type Handler = (request: NextRequest, context: { params: Promise<any> }) => Promise<Response>;
let world: ReviewsWorld;
let putCart: Handler;
let listGET: Handler;
let itemPATCH: Handler;
let itemDELETE: Handler;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let ipSeq = 0;
let savedEnv: Record<string, string | undefined> = {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  putCart = (await import('../src/app/api/storefront/v1/stores/[id]/abandoned-cart/route')).PUT as Handler;
  listGET = (await import('../src/app/api/stores/[id]/abandoned-carts/route')).GET as Handler;
  const item = (await import('../src/app/api/stores/[id]/abandoned-carts/[cartId]/route')) as any;
  itemPATCH = item.PATCH;
  itemDELETE = item.DELETE;
});

beforeEach(() => {
  resetRateLimits();
  ipSeq = 0;
  world = installReviewsWorld();
  // The catalog the server prices from: two products with one variant each (the browser never sends a price).
  const variants: Record<string, Row> = {
    [PRODUCT_P1]: { _id: V1, title: 'M', price: 1000, trackQuantity: true, stockQuantity: 5, position: 0 },
    [PRODUCT_P2]: { _id: V2, title: 'Default', price: 500, trackQuantity: true, stockQuantity: 0, position: 0 },
  };
  for (const product of world.products) {
    product.variants = [variants[String(product._id)]];
    product.deliveryCharge = null;
  }
  savedEnv = {
    unsub: process.env.UNSUBSCRIBE_SIGNING_SECRET,
    portal: process.env.APP_BASE_URL_SELLER,
    storefront: process.env.STOREFRONT_URL,
  };
});

afterEach(() => {
  world.restore();
  for (const [name, key] of [['unsub', 'UNSUBSCRIBE_SIGNING_SECRET'], ['portal', 'APP_BASE_URL_SELLER'], ['storefront', 'STOREFRONT_URL']] as const) {
    if (savedEnv[name] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[name];
  }
});

const nextIp = (): string => '203.0.113.' + String((ipSeq += 1) % 250);
const line = (extra: Row = {}) => ({ productId: PRODUCT_P1, variantId: V1, qty: 2, ...extra });

function save(body: Row = {}, store = STORE_A, headers: Row = {}) {
  return putCart(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + store + '/abandoned-cart', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...headers },
      body: JSON.stringify({ phone: '0300 1234567', consent: true, lines: [line()], ...body }),
    }),
    { params: Promise.resolve({ id: store }) },
  );
}

/** The limiter counts in fixed windows aligned to the clock: a run that straddles a minute boundary would restart its count. Wait out the last seconds of a window first. */
async function inSafeWindow(): Promise<void> {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 8_000) await new Promise((resolve) => setTimeout(resolve, left + 50));
}


const json = async (res: Response) => (await res.json()) as any;
const open = (): Row[] => world.carts.filter((cart) => cart.status === 'open');

// ----------------------------------------------------------------------------------------------------------------------- the capture

test('a valid phone and the consent keep the cart: ONE open cart, the phone normalized, priced by the server, expiring 7 days after the last activity', async () => {
  const before = Date.now();
  const res = await save({ email: 'Ayesha@Example.PK' });
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { data: { saved: true } });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(world.carts.length, 1);
  const cart = world.carts[0]!;
  assert.equal(cart.phone, PHONE, 'any spelling is stored as +923xxxxxxxxx');
  assert.equal(cart.email, 'ayesha@example.pk');
  assert.equal(cart.status, 'open');
  assert.equal(cart.total, 2000);
  assert.deepEqual(cart.items.map((i: Row) => [String(i.productId), i.variantId, i.productTitle, i.variantTitle, i.quantity, i.unitPrice]), [[PRODUCT_P1, V1, 'Shirt', 'M', 2, 1000]]);
  assert.ok(cart.consentAt instanceof Date);
  assert.ok(cart.lastSeenAt.getTime() >= before);
  assert.equal(cart.expiresAt.getTime() - cart.lastSeenAt.getTime(), 7 * DAY, 'the TTL index deletes it 7 days after the last activity');
});

test('nothing is stored without a valid phone AND the consent: each is a 400 naming the field, before anything is read', async () => {
  const cases: Array<[Row, string]> = [
    [{ consent: undefined }, 'consent'],
    [{ consent: false }, 'consent'],
    [{ consent: 'yes' }, 'consent'],
    [{ phone: '' }, 'phone'],
    [{ phone: '12345' }, 'phone'],
    [{ phone: '0200 1234567' }, 'phone'],
    [{ phone: undefined }, 'phone'],
    [{ lines: [] }, 'lines'],
    [{ lines: undefined }, 'lines'],
  ];
  for (const [fields, field] of cases) {
    const res = await save(fields);
    assert.equal(res.status, 400, JSON.stringify(fields));
    const body = await json(res);
    assert.equal(body.error.code, 'INVALID_REQUEST');
    assert.equal(body.field, field, JSON.stringify(fields));
  }
  assert.equal(world.carts.length, 0, 'not one cart was written');
});

test('the total and the prices are recomputed by the server from the product ids: whatever the browser sends is never read', async () => {
  const res = await save({ total: 1, subtotal: 1, price: 1, lines: [line({ unitPrice: 1, price: 1, total: 1, title: 'Free shirt' })] });
  assert.equal(res.status, 200);
  const cart = world.carts[0]!;
  assert.equal(cart.total, 2000);
  assert.equal(cart.items[0].unitPrice, 1000);
  assert.equal(cart.items[0].productTitle, 'Shirt');
});

test('a line that cannot be bought (out of stock, unknown product) is left out, and a cart with nothing buyable is refused (400 lines) and not stored', async () => {
  const mixed = await save({ lines: [line(), { productId: PRODUCT_P2, variantId: V2, qty: 1 }, { productId: '65a0000000000000000c0099', qty: 1 }] });
  assert.equal(mixed.status, 200);
  assert.deepEqual(world.carts[0]!.items.map((i: Row) => String(i.productId)), [PRODUCT_P1]);
  assert.equal(world.carts[0]!.total, 2000);

  world.carts.length = 0;
  const none = await save({ lines: [{ productId: PRODUCT_P2, variantId: V2, qty: 1 }] });
  assert.equal(none.status, 400);
  assert.equal((await json(none)).field, 'lines');
  assert.equal(world.carts.length, 0);
});

test('one open cart per store and phone: a second call (even in another spelling) refreshes it; another phone, or another store, is another cart', async () => {
  assert.equal((await save({ lines: [line({ qty: 1 })] })).status, 200);
  const first = world.carts[0]!;
  first.lastSeenAt = new Date(Date.now() - 3 * HOUR);
  first.expiresAt = new Date(first.lastSeenAt.getTime() + 7 * DAY);
  const consentAt = first.consentAt;

  assert.equal((await save({ phone: '+92 300 1234567', lines: [line({ qty: 3 })] })).status, 200);
  assert.equal(open().length, 1, 'still ONE open cart');
  assert.equal(world.carts[0]!.items[0].quantity, 3, 'the items follow the shopper');
  assert.equal(world.carts[0]!.total, 3000);
  assert.ok(world.carts[0]!.lastSeenAt.getTime() > Date.now() - 60_000, 'the last activity moved forward');
  assert.ok(world.carts[0]!.expiresAt.getTime() > Date.now() + 6 * DAY, 'so did the expiry');
  assert.equal(world.carts[0]!.consentAt, consentAt, 'the first consent stays');

  assert.equal((await save({ phone: '0301 2345678' })).status, 200);
  assert.equal(open().length, 2);
  world.products.push({ ...world.products[0]!, _id: '65a0000000000000000c0055', store: STORE_B });
  world.products.at(-1)!.variants = [{ _id: V1, title: 'M', price: 900, trackQuantity: true, stockQuantity: 5, position: 0 }];
  assert.equal((await save({ lines: [{ productId: '65a0000000000000000c0055', variantId: V1, qty: 1 }] }, STORE_B)).status, 200);
  assert.equal(world.carts.filter((c) => c.phone === PHONE).length, 2, 'the same phone in another store is its own cart');
});

test('two parallel first calls for one phone: ONE open cart (the partial unique index decides, the loser refreshes it)', async () => {
  const answers = await Promise.all([save(), save(), save({ lines: [line({ qty: 4 })] })]);
  assert.deepEqual(answers.map((res) => res.status), [200, 200, 200]);
  assert.equal(open().filter((c) => c.phone === PHONE).length, 1);
});

test('a contacted cart keeps being refreshed but stays contacted; after a recovered cart the same phone starts a new open cart', async () => {
  const contacted = world.cart({ status: 'contacted', contactedAt: new Date(), lastSeenAt: new Date(Date.now() - 5 * HOUR) });
  assert.equal((await save({ lines: [line({ qty: 5 })] })).status, 200);
  assert.equal(world.carts.length, 1);
  assert.equal(contacted.status, 'contacted');
  assert.equal(contacted.items[0].quantity, 5);

  contacted.status = 'recovered';
  assert.equal((await save()).status, 200);
  assert.equal(world.carts.length, 2);
  assert.equal(open().length, 1);
});

test('rate limited per client address: the 31st call in a minute is 429', async () => {
  await inSafeWindow();
  let refusedAt = 0;
  for (let call = 1; call <= 32; call += 1) {
    const res = await save({}, STORE_A, { 'x-forwarded-for': '198.51.100.42' });
    if (res.status === 429 && refusedAt === 0) refusedAt = call;
  }
  assert.equal(refusedAt, 31);
});

test('a seller\'s preview stores nothing (it answers like a save), and an inactive or unknown store is refused like the other storefront routes', async () => {
  const preview = await save({}, STORE_A, { [PREVIEW_CREDENTIAL_HEADER]: 'x'.repeat(40) });
  assert.equal(preview.status, 200);
  assert.equal(world.carts.length, 0);
  world.stores[0]!.status = 'suspended';
  assert.equal((await save()).status, 403);
  assert.equal((await save({}, 'nope')).status, 404);
});

// -------------------------------------------------------------------------------------------------------------------------- recovered

test('an order with the same phone key marks the open cart recovered with the order id, and a contacted one too; other phones and other stores are untouched', async () => {
  const mine = world.cart({ phone: PHONE });
  const contacted = world.cart({ phone: PHONE, status: 'contacted' });
  const other = world.cart({ phone: '+923012345678' });
  const foreignStore = world.cart({ phone: PHONE, store: STORE_B });
  const done = world.cart({ phone: PHONE, status: 'recovered', recoveredOrder: '65a0000000000000000a00bb' });

  assert.equal(await markCartRecovered(STORE_A, phoneKeyOf('0300 1234567'), FIRST_ORDER), 2);
  for (const cart of [mine, contacted]) {
    assert.equal(cart.status, 'recovered');
    assert.equal(String(cart.recoveredOrder), FIRST_ORDER);
    assert.ok(cart.recoveredAt instanceof Date);
  }
  assert.equal(other.status, 'open');
  assert.equal(foreignStore.status, 'open');
  assert.equal(String(done.recoveredOrder), '65a0000000000000000a00bb', 'an earlier recovery keeps its own order');
  assert.equal(await markCartRecovered(STORE_A, PHONE, FIRST_ORDER), 0, 'a repeat finds nothing to do');
});

test('nothing happens for an order without a phone key, and a failure never throws', async () => {
  world.cart();
  assert.equal(await markCartRecovered(STORE_A, undefined, FIRST_ORDER), 0);
  assert.equal(await markCartRecovered(STORE_A, '0300', FIRST_ORDER), 0);
  assert.equal(open().length, 1);
});

// ------------------------------------------------------------------------------------------------------------------------- the seller

function seller(method: string, options: { id?: string; token?: string | null; store?: string; search?: string; body?: unknown } = {}) {
  const store = options.store ?? STORE_A;
  const token = options.token === undefined ? tokenA : options.token;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const request = new NextRequest('http://seller.test/api/stores/' + store + '/abandoned-carts' + (options.id ? '/' + options.id : '') + (options.search ?? ''), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const handler = method === 'GET' ? listGET : method === 'PATCH' ? itemPATCH : itemDELETE;
  return handler(request, { params: Promise.resolve({ id: store, ...(options.id ? { cartId: options.id } : {}) }) });
}

test('the list: the store\'s carts newest first, with the open count, filtered by status, paged, and a cart past its 7 days is not listed', async () => {
  const now = Date.now();
  const newest = world.cart({ lastSeenAt: new Date(now - 10 * 60_000), phone: '+923001111111' });
  const older = world.cart({ lastSeenAt: new Date(now - 2 * HOUR), phone: '+923002222222' });
  const contacted = world.cart({ status: 'contacted', lastSeenAt: new Date(now - 3 * HOUR), phone: '+923003333333' });
  const recovered = world.cart({ status: 'recovered', lastSeenAt: new Date(now - 4 * HOUR), phone: '+923004444444' });
  world.cart({ lastSeenAt: new Date(now - 9 * DAY), phone: '+923005555555', expiresAt: new Date(now - 2 * DAY) });
  world.cart({ store: STORE_B, phone: '+923006666666' });

  const all = await json(await seller('GET'));
  assert.deepEqual(all.docs.map((d: Row) => d.id), [newest, older, contacted, recovered].map((c) => String(c._id)));
  assert.equal(all.openCount, 2);
  assert.equal(all.totalDocs, 4);
  const onlyOpen = await json(await seller('GET', { search: '?status=open' }));
  assert.deepEqual(onlyOpen.docs.map((d: Row) => d.id), [String(newest._id), String(older._id)]);
  assert.equal(onlyOpen.openCount, 2, 'the count ignores the filter');
  const paged = await json(await seller('GET', { search: '?limit=2&page=2' }));
  assert.equal(paged.docs.length, 2);
  assert.equal(paged.totalPages, 2);
  assert.equal((await seller('GET', { search: '?status=expired' })).status, 400);
  assert.equal((await seller('GET', { search: '?limit=51' })).status, 400);
  const first = all.docs[0];
  assert.deepEqual(Object.keys(first).sort(), ['contactedAt', 'createdAt', 'email', 'id', 'items', 'lastSeenAt', 'phone', 'recoveredOrder', 'status', 'total']);
  assert.equal(first.phone, '+923001111111');
});

test('mark contacted: ONE compare-and-set on an open cart; a second mark, or a cart already recovered, is 409 and nothing is overwritten; the audit entry holds ids only', async () => {
  const cart = world.cart({ phone: '+923007777777', email: 'a@b.pk' });
  const res = await seller('PATCH', { id: String(cart._id), body: { status: 'contacted' } });
  assert.equal(res.status, 200);
  assert.equal((await json(res)).cart.status, 'contacted');
  assert.ok(cart.contactedAt instanceof Date);
  const again = await seller('PATCH', { id: String(cart._id), body: { status: 'contacted' } });
  assert.equal(again.status, 409);
  assert.equal((await json(again)).code, 'ABANDONED_CART_STATUS_CHANGED');

  const done = world.cart({ status: 'recovered', phone: '+923008888888' });
  assert.equal((await seller('PATCH', { id: String(done._id), body: { status: 'contacted' } })).status, 409);
  assert.equal(done.status, 'recovered');

  const entries = world.audits.filter((a) => String(a.action).startsWith('abandoned_cart.'));
  assert.deepEqual(entries.map((a) => a.action), ['abandoned_cart.contacted']);
  const text = JSON.stringify(entries);
  for (const secret of ['+923007777777', 'a@b.pk', 'Shirt']) assert.equal(text.includes(secret), false, secret);
});

test('the body is strict: any other status or field is 400 naming the field, and the cart is untouched', async () => {
  const cart = world.cart();
  for (const [body, field] of [[{ status: 'recovered' }, 'status'], [{ status: 'open' }, 'status'], [{}, 'status'], [{ status: 'contacted', phone: '0300' }, 'phone']] as Array<[Row, string]>) {
    const res = await seller('PATCH', { id: String(cart._id), body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await json(res)).field, field);
  }
  assert.equal(cart.status, 'open');
});

test('delete removes one cart of this store (audited, ids only); a second delete is 404', async () => {
  const cart = world.cart();
  const res = await seller('DELETE', { id: String(cart._id) });
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { removed: true, id: String(cart._id) });
  assert.equal(world.carts.length, 0);
  assert.equal((await seller('DELETE', { id: String(cart._id) })).status, 404);
  assert.deepEqual(world.audits.filter((a) => String(a.action).startsWith('abandoned_cart.')).map((a) => a.action), ['abandoned_cart.delete']);
});

test('scoping: no login is 401, an admin is 403, Seller B on Seller A\'s store is 403, a foreign cart id is 404 and stays untouched', async () => {
  const mine = world.cart();
  const theirs = world.cart({ store: STORE_B, phone: '+923009999999' });
  assert.equal((await seller('GET', { token: null })).status, 401);
  assert.equal((await seller('GET', { token: tokenAdmin })).status, 403);
  assert.equal((await seller('GET', { token: tokenB })).status, 403);
  assert.equal((await seller('PATCH', { id: String(mine._id), token: tokenB, body: { status: 'contacted' } })).status, 403);
  assert.equal((await seller('DELETE', { id: String(mine._id), token: tokenB })).status, 403);
  assert.equal(mine.status, 'open');
  assert.equal(world.carts.length, 2);

  assert.equal((await seller('PATCH', { id: String(theirs._id), body: { status: 'contacted' } })).status, 404, 'Seller A cannot touch Seller B\'s cart through their own store');
  assert.equal((await seller('DELETE', { id: String(theirs._id) })).status, 404);
  assert.equal((await seller('DELETE', { id: 'nope' })).status, 404);
  assert.equal(theirs.status, 'open');
  const listed = await json(await seller('GET', { token: tokenB, store: STORE_B }));
  assert.deepEqual(listed.docs.map((d: Row) => d.id), [String(theirs._id)]);
});

// -------------------------------------------------------------------------------------------------------------- the optional email

function emailWorld(): void {
  process.env.UNSUBSCRIBE_SIGNING_SECRET = 'u'.repeat(32);
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  process.env.STOREFRONT_URL = 'https://markazify.com';
}
const NOW = new Date('2026-11-21T12:00:00Z');
const stale = (extra: Row = {}) => world.cart({ email: 'ayesha@example.pk', lastSeenAt: new Date(NOW.getTime() - 3 * HOUR), expiresAt: new Date(NOW.getTime() + 4 * DAY), ...extra });
const queued = () => world.outbox.filter((row) => row.template === 'abandoned_cart');

test('the email is OFF by default: a store that never switched it on gets nothing, however many carts are due', async () => {
  emailWorld();
  stale();
  const result = await queueAbandonedCartEmails(NOW);
  assert.deepEqual(result, { queued: 0, skippedUnsubscribed: 0 });
  assert.equal(queued().length, 0);
  assert.equal(world.carts[0]!.emailQueuedAt, null, 'the cart was not even claimed');
});

test('switched on: ONE email per due cart, 2 hours after the last activity, once (a second run queues nothing), under the key abandoned:<cartId>', async () => {
  emailWorld();
  world.stores[0]!.paymentSettings = { ...world.stores[0]!.paymentSettings, abandonedCartEmail: true };
  const due = stale();
  const tooNew = stale({ lastSeenAt: new Date(NOW.getTime() - 30 * 60_000), phone: '+923001110000' });
  const noEmail = stale({ email: null, phone: '+923001110001' });
  const contacted = stale({ status: 'contacted', phone: '+923001110002' });
  const recovered = stale({ status: 'recovered', phone: '+923001110003' });

  assert.deepEqual(await queueAbandonedCartEmails(NOW), { queued: 1, skippedUnsubscribed: 0 });
  assert.equal(queued().length, 1);
  assert.equal(queued()[0]!.dedupeKey, 'abandoned:' + String(due._id));
  assert.equal(queued()[0]!.to, 'ayesha@example.pk');
  assert.ok(due.emailQueuedAt instanceof Date);
  for (const cart of [tooNew, noEmail, contacted, recovered]) assert.equal(cart.emailQueuedAt, null, 'not emailed: ' + cart.phone);

  assert.deepEqual(await queueAbandonedCartEmails(NOW), { queued: 0, skippedUnsubscribed: 0 });
  assert.equal(queued().length, 1, 'never a second email for one cart');
  // 2 hours later the cart that was too new is due.
  assert.equal((await queueAbandonedCartEmails(new Date(NOW.getTime() + 2 * HOUR))).queued, 1);
});

test('SB-6 (bug 11): switching the email on never mails the carts that were already waiting: only a cart left AFTER the switch went on', async () => {
  emailWorld();
  const switchedOn = new Date(NOW.getTime() - 150 * 60_000); // 2 h 30 min ago
  world.stores[0]!.paymentSettings = { abandonedCartEmail: true, abandonedCartEmailSince: switchedOn };
  const before = stale({ lastSeenAt: new Date(NOW.getTime() - 3 * HOUR), phone: '+923001110020' }); // left while the email was off
  const after = stale({ lastSeenAt: new Date(NOW.getTime() - 140 * 60_000), phone: '+923001110021', email: 'sana@example.pk' }); // left after it went on, idle 2 h 20
  const exactly = stale({ lastSeenAt: switchedOn, phone: '+923001110022', email: 'hira@example.pk' });
  assert.deepEqual(await queueAbandonedCartEmails(NOW), { queued: 1, skippedUnsubscribed: 0 });
  assert.deepEqual(queued().map((row) => row.to), ['sana@example.pk']);
  assert.equal(before.emailQueuedAt, null, 'the older cart is never claimed, so it is never mailed');
  assert.equal(exactly.emailQueuedAt, null, 'a cart last seen at the very moment of the switch is not after it');
  assert.ok(after.emailQueuedAt instanceof Date);
  assert.equal((await queueAbandonedCartEmails(new Date(NOW.getTime() + 5 * HOUR))).queued, 0, 'the old carts stay unmailed later too (they are not after the switch)');
});

test('a store that switched the email on before the field existed has no lower bound (as before)', async () => {
  emailWorld();
  world.stores[0]!.paymentSettings = { abandonedCartEmail: true };
  stale({ lastSeenAt: new Date(NOW.getTime() - 30 * HOUR) });
  assert.equal((await queueAbandonedCartEmails(NOW)).queued, 1);
});

test('a recovered or contacted cart is never emailed, even when it is old enough', async () => {
  emailWorld();
  world.stores[0]!.paymentSettings = { abandonedCartEmail: true };
  const recovered = stale({ status: 'recovered', recoveredOrder: FIRST_ORDER });
  const contacted = stale({ status: 'contacted', phone: '+923001110009' });
  assert.equal((await queueAbandonedCartEmails(NOW)).queued, 0);
  assert.equal(queued().length, 0);
  assert.equal(recovered.emailQueuedAt, null);
  assert.equal(contacted.emailQueuedAt, null);
});

test('never to an unsubscribed address: the cart is retired without an email', async () => {
  emailWorld();
  world.stores[0]!.paymentSettings = { abandonedCartEmail: true };
  world.unsubscribed.push('ayesha@example.pk');
  const cart = stale();
  const other = stale({ email: 'sana@example.pk', phone: '+923001110004' });
  assert.deepEqual(await queueAbandonedCartEmails(NOW), { queued: 1, skippedUnsubscribed: 1 });
  assert.deepEqual(queued().map((row) => row.to), ['sana@example.pk']);
  assert.ok(cart.emailQueuedAt instanceof Date, 'retired, so it never blocks the queue');
  assert.ok(other.emailQueuedAt instanceof Date);
  assert.equal((await queueAbandonedCartEmails(NOW)).queued, 0);
});

test('the email carries the signed unsubscribe link and the store link, and escapes every value (an item named like markup is text)', async () => {
  emailWorld();
  world.stores[0]!.paymentSettings = { abandonedCartEmail: true };
  world.stores[0]!.name = 'Zara <Lawn>';
  stale({ items: [{ productId: PRODUCT_P1, variantId: V1, productTitle: '<img src=x onerror=alert(1)>', variantTitle: 'M', quantity: 2, unitPrice: 1000 }], total: 2000 });
  await queueAbandonedCartEmails(NOW);
  const email = queued()[0]!;
  assert.ok(email, 'queued');
  assert.equal(String(email.bodyHtml).includes('<img'), false);
  assert.ok(String(email.bodyHtml).includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(String(email.bodyHtml).includes('Zara <Lawn>'), false);
  assert.match(String(email.bodyText), /https:\/\/seller\.markazify\.com\/unsubscribe\?s=65a000000000000000000011&e=ayesha%40example\.pk&t=[0-9a-f]{64}/);
  assert.ok(String(email.bodyText).includes('https://zara.markazify.com') || String(email.bodyText).includes('markazify.com'));
  assert.ok(String(email.bodyText).includes('Rs. 2,000'));
});

test('without the unsubscribe secret or the portal address nothing is queued (a message never goes out without its unsubscribe link)', async () => {
  world.stores[0]!.paymentSettings = { abandonedCartEmail: true };
  process.env.STOREFRONT_URL = 'https://markazify.com';
  delete process.env.UNSUBSCRIBE_SIGNING_SECRET;
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  stale();
  assert.equal((await queueAbandonedCartEmails(NOW)).queued, 0);
  process.env.UNSUBSCRIBE_SIGNING_SECRET = 'u'.repeat(32);
  delete process.env.APP_BASE_URL_SELLER;
  assert.equal((await queueAbandonedCartEmails(NOW)).queued, 0);
  assert.equal(world.carts[0]!.emailQueuedAt, null);
});
