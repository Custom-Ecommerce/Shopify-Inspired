import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';
import { settleRevalidations } from '../src/lib/revalidate';
import { sendReviewReceived } from '@/lib/notifications';
import { ORDER_A, ORDER_B, PHONE, STORE_A, STORE_B, settle, type Row } from './helpers/returns-world';
import { PRODUCT_P1, PRODUCT_P2, installReviewsWorld, type ReviewsWorld } from './helpers/reviews-world';

// Sprint 5 EP-21.US01.T02, T03 and US02.T03 (D-107, D-108): the PUBLIC review routes under /api/storefront/v1/stores/:id/. The credential is the order
// number plus the phone (the same 404 for a wrong phone, an unknown order and another store's order). Only a delivered order, one review per product per
// order, plain text kept as typed and escaped by every output, published at once, rate limited per address AND per order number. A product's reviews are
// read approved only, newest first, paged, with the average and the count, and every change purges the product's cache tag.
// Models are in memory (./helpers/reviews-world).

type Ctx = { params: Promise<{ id: string; number?: string; slug?: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let world: ReviewsWorld;
let eligibilityGET: Handler;
let createPOST: Handler;
let listGET: Handler;
let ipSeq = 0;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';
  eligibilityGET = (await import('../src/app/api/storefront/v1/stores/[id]/orders/[number]/review-eligibility/route')).GET as Handler;
  createPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/[number]/reviews/route')).POST as Handler;
  listGET = (await import('../src/app/api/storefront/v1/stores/[id]/products/[slug]/reviews/route')).GET as Handler;
});

beforeEach(() => {
  resetRateLimits();
  ipSeq = 0;
  world = installReviewsWorld();
});

afterEach(() => world.restore());

const nextIp = (): string => '203.0.113.' + String((ipSeq += 1) % 250);

function eligibility(number = 'ORD-ABCD2345', phone: string | null = PHONE, store = STORE_A, headers: Row = {}) {
  const query = phone === null ? '' : '?phone=' + encodeURIComponent(phone);
  return eligibilityGET(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + store + '/orders/' + number + '/review-eligibility' + query, { headers: { 'x-forwarded-for': nextIp(), ...headers } }),
    { params: Promise.resolve({ id: store, number }) },
  );
}

function review(body: Row = {}, number = 'ORD-ABCD2345', store = STORE_A, headers: Row = {}) {
  return createPOST(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + store + '/orders/' + number + '/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...headers },
      body: JSON.stringify({ phone: PHONE, productId: PRODUCT_P1, rating: 5, body: 'Soft fabric, true to size.', displayName: 'Ayesha K.', ...body }),
    }),
    { params: Promise.resolve({ id: store, number }) },
  );
}

function list(slug = 'shirt', query = '', store = STORE_A, headers: Row = {}) {
  return listGET(new NextRequest('http://localhost/api/storefront/v1/stores/' + store + '/products/' + slug + '/reviews' + query, { headers: { 'x-forwarded-for': nextIp(), ...headers } }), {
    params: Promise.resolve({ id: store, slug }),
  });
}

/** The limiter counts in fixed windows aligned to the clock: a run that straddles a minute boundary would restart its count. Wait out the last seconds of a window first. */
async function inSafeWindow(): Promise<void> {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 8_000) await new Promise((resolve) => setTimeout(resolve, left + 50));
}


const json = async (res: Response) => (await res.json()) as any;
const deliveredOn = (when: Date) => [{ from: 'dispatched', to: 'delivered', by: null, at: when, note: null }];

// ------------------------------------------------------------------------------------------------------------------- eligibility

test('eligibility: a delivered order lists its products once each (the variants of one product share one review), and nothing about the customer', async () => {
  world.deliveredOrder();
  const res = await eligibility();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { data } = await json(res);
  assert.equal(data.eligible, true);
  assert.deepEqual(data.items.map((item: Row) => [item.productId, item.productTitle]), [[PRODUCT_P1, 'Shirt'], [PRODUCT_P2, 'Cap']]);
  const text = JSON.stringify(data);
  for (const secret of ['Sara Khan', PHONE, '0300', 'sara@example.pk', 'ORD-ABCD2345']) assert.equal(text.includes(secret), false, secret);
});

test('eligibility: two variants of one product are ONE reviewable product', async () => {
  world.deliveredOrder({
    items: [
      { productId: PRODUCT_P1, variantId: '65a0000000000000000d0001', productTitle: 'Shirt', variantTitle: 'M', unitPrice: 1000, quantity: 1, stockDeducted: true },
      { productId: PRODUCT_P1, variantId: '65a0000000000000000d0009', productTitle: 'Shirt', variantTitle: 'L', unitPrice: 1000, quantity: 1, stockDeducted: true },
    ],
  });
  const { data } = await json(await eligibility());
  assert.equal(data.items.length, 1);
});

test('eligibility: an order that was never delivered cannot be reviewed (no items, reason not_delivered)', async () => {
  world.deliveredOrder({ status: 'dispatched', statusHistory: [] });
  const { data } = await json(await eligibility());
  assert.deepEqual(data, { eligible: false, reason: 'not_delivered', items: [] });
});

test('eligibility: a reviewed product leaves the list, and nothing_to_review once every product is reviewed', async () => {
  world.deliveredOrder();
  assert.equal((await review({ productId: PRODUCT_P1 })).status, 201);
  let { data } = await json(await eligibility());
  assert.deepEqual(data.items.map((item: Row) => item.productId), [PRODUCT_P2]);
  assert.equal((await review({ productId: PRODUCT_P2 })).status, 201);
  ({ data } = await json(await eligibility()));
  assert.deepEqual(data, { eligible: false, reason: 'nothing_to_review', items: [] });
});

test('a wrong phone, an unknown order and another store\'s order are the SAME 404, for the eligibility and for the review, and the phone is read in any spelling', async () => {
  world.deliveredOrder();
  world.deliveredOrder({ _id: ORDER_B, store: STORE_B, orderId: 'ORD-BBBB2222' });
  for (const phone of ['0300 1234567', '03001234567', '+92 300 1234567', '923001234567']) assert.equal((await eligibility('ORD-ABCD2345', phone)).status, 200, phone);
  assert.equal((await eligibility('ord-abcd2345')).status, 200, 'the order number is read in any letter case');
  const wrongPhone = await eligibility('ORD-ABCD2345', '03009999999');
  const unknown = await eligibility('ORD-ZZZZ9999');
  const foreign = await eligibility('ORD-BBBB2222');
  assert.deepEqual([wrongPhone.status, unknown.status, foreign.status], [404, 404, 404]);
  const bodies = [await json(wrongPhone), await json(unknown), await json(foreign)];
  assert.deepEqual(bodies[1], bodies[0]);
  assert.deepEqual(bodies[2], bodies[0]);
  assert.equal(bodies[0].error.code, 'ORDER_NOT_FOUND');

  const posted = [await review({ phone: '03009999999' }), await review({}, 'ORD-ZZZZ9999'), await review({}, 'ORD-BBBB2222')];
  assert.deepEqual(posted.map((res) => res.status), [404, 404, 404]);
  const postedBodies = [await json(posted[0]!), await json(posted[1]!), await json(posted[2]!)];
  assert.deepEqual(postedBodies[1], postedBodies[0]);
  assert.deepEqual(postedBodies[2], postedBodies[0]);
  assert.equal(world.reviews.length, 0, 'nothing was written');
});

test('the phone must be a Pakistani mobile number: 400 INVALID_REQUEST naming the field', async () => {
  world.deliveredOrder();
  const noPhone = await eligibility('ORD-ABCD2345', null);
  assert.equal(noPhone.status, 400);
  assert.equal((await json(noPhone)).field, 'phone');
  const bad = await review({ phone: '12345' });
  assert.equal(bad.status, 400);
  assert.equal((await json(bad)).field, 'phone');
});

// ------------------------------------------------------------------------------------------------------------------------ create

test('a review of a delivered order is published at once: status approved, verified, the display name, no customer, and the product\'s rating is recomputed', async () => {
  world.deliveredOrder();
  const res = await review({ rating: 4, title: 'Lovely', displayName: 'Ayesha K.' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { data } = await json(res);
  assert.equal(data.status, 'approved');
  assert.equal(world.reviews.length, 1);
  const stored = world.reviews[0]!;
  assert.equal(stored.status, 'approved');
  assert.equal(stored.verified, true);
  assert.equal(stored.customer, null);
  assert.equal(stored.displayName, 'Ayesha K.');
  assert.equal(stored.title, 'Lovely');
  assert.equal(String(stored.order), ORDER_A);
  assert.equal(String(stored.product), PRODUCT_P1);
  assert.deepEqual(world.productWrites.map((w) => [w.avgRating, w.reviewCount]), [[4, 1]]);
  assert.equal(world.products.find((p) => p._id === PRODUCT_P1)!.reviewCount, 1);
});

test('delivered only: a pending, a dispatched and a never delivered order refuse with 422 REVIEW_NOT_ELIGIBLE (not_delivered) and write nothing', async () => {
  for (const status of ['pending', 'confirmed', 'dispatched']) {
    world.orders.length = 0;
    world.deliveredOrder({ status, statusHistory: [] });
    const res = await review();
    assert.equal(res.status, 422, status);
    const body = await json(res);
    assert.equal(body.error.code, 'REVIEW_NOT_ELIGIBLE', status);
    assert.equal(body.reason, 'not_delivered', status);
  }
  assert.equal(world.reviews.length, 0);
});

test('one review per product per order: the second is refused (already_reviewed), a different product of the same order is accepted', async () => {
  world.deliveredOrder();
  assert.equal((await review()).status, 201);
  const second = await review({ rating: 1, body: 'I changed my mind about this one' });
  assert.equal(second.status, 422);
  const body = await json(second);
  assert.equal(body.error.code, 'REVIEW_NOT_ELIGIBLE');
  assert.equal(body.reason, 'already_reviewed');
  assert.equal(world.reviews.length, 1, 'the first review stands');
  assert.equal((await review({ productId: PRODUCT_P2 })).status, 201);
  assert.equal(world.reviews.length, 2);
});

test('two parallel posts for the same product: exactly one review is saved, the loser answers already_reviewed (the unique { order, product } index decides)', async () => {
  world.deliveredOrder();
  const answers = await Promise.all([review(), review(), review()]);
  assert.deepEqual(answers.map((res) => res.status).sort(), [201, 422, 422]);
  assert.equal(world.reviews.length, 1);
});

test('a product that is not in the order is refused (unknown_product); a malformed product id is a 400', async () => {
  world.deliveredOrder();
  const res = await review({ productId: '65a0000000000000000c0099' });
  assert.equal(res.status, 422);
  assert.equal((await json(res)).reason, 'unknown_product');
  const bad = await review({ productId: 'not-an-id' });
  assert.equal(bad.status, 400);
  assert.equal((await json(bad)).field, 'productId');
  assert.equal(world.reviews.length, 0);
});

test('the text is plain text kept as typed (a tag is three characters, not markup), control characters are cleaned, and an empty name reads Customer', async () => {
  world.deliveredOrder();
  const res = await review({ body: '<script>alert(1)</script> nice\u0000 fabric\r\nsecond line', title: '  <b>Great</b>  ', displayName: '   ' });
  assert.equal(res.status, 201);
  const stored = world.reviews[0]!;
  assert.equal(stored.body, '<script>alert(1)</script> nice fabric\nsecond line');
  assert.equal(stored.title, '<b>Great</b>');
  assert.equal(stored.displayName, 'Customer');
});

test('the fields are bounded and named: a rating outside 1 to 5, a short or a long text, a long name or title, an unknown field', async () => {
  world.deliveredOrder();
  const cases: Array<[Row, string]> = [
    [{ rating: 0 }, 'rating'],
    [{ rating: 6 }, 'rating'],
    [{ rating: 4.5 }, 'rating'],
    [{ body: 'ok' }, 'body'],
    [{ body: 'x'.repeat(1001) }, 'body'],
    [{ title: 'x'.repeat(81) }, 'title'],
    [{ displayName: 'x'.repeat(41) }, 'displayName'],
    [{ status: 'approved' }, 'status'],
    [{ customer: '65a0000000000000000000aa' }, 'customer'],
  ];
  for (const [fields, field] of cases) {
    const res = await review(fields);
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.equal((await json(res)).field, field, JSON.stringify(fields));
  }
  assert.equal((await review({ body: 'x'.repeat(1000), title: 'y'.repeat(80), displayName: 'z'.repeat(40) })).status, 201);
});

test('the seller\'s email and bell alert escape what the shopper wrote: the template puts the tags in the HTML part as text', async () => {
  world.deliveredOrder();
  assert.equal((await review({ body: '<img src=x onerror=alert(1)> nice fabric' })).status, 201);
  await settle();
  const email = world.outbox.find((row) => row.template === 'review_received_seller');
  assert.ok(email, 'the seller got one email');
  assert.equal(String(email!.bodyHtml).includes('<img'), false);
  assert.ok(String(email!.bodyHtml).includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(world.alerts.filter((a) => a.kind === 'review_received').length, 1);
});

test('rate limited per client address AND per order number: the 11th call of one address, and the 11th call at one order from many addresses, are 429', async () => {
  world.deliveredOrder();
  await inSafeWindow();
  for (let call = 0; call < 10; call += 1) assert.equal((await eligibility('ORD-ABCD2345', PHONE, STORE_A, { 'x-forwarded-for': '198.51.100.7' })).status, 200);
  const byAddress = await eligibility('ORD-ABCD2345', PHONE, STORE_A, { 'x-forwarded-for': '198.51.100.7' });
  assert.equal(byAddress.status, 429);
  assert.equal((await json(byAddress)).error.code, 'RATE_LIMITED');
  assert.ok(byAddress.headers.get('retry-after'));

  resetRateLimits();
  await inSafeWindow();
  let refusedAt = 0;
  for (let call = 1; call <= 12; call += 1) {
    const res = await review({ phone: '03009999999' }, 'ORD-ABCD2345', STORE_A, { 'x-forwarded-for': '192.0.2.' + call });
    if (res.status === 429 && refusedAt === 0) refusedAt = call;
  }
  assert.equal(refusedAt, 11, 'many addresses cannot hammer one order number');
});

test('a store that is not active, and an unknown store, answer like the other storefront routes', async () => {
  world.deliveredOrder();
  world.stores[0]!.status = 'suspended';
  assert.equal((await eligibility()).status, 403);
  assert.equal((await review()).status, 403);
  assert.equal((await eligibility('ORD-ABCD2345', PHONE, 'not-an-id')).status, 404);
});

// -------------------------------------------------------------------------------------------------------------- reading a product

test('the public list: approved only, newest first, with the average and the count of ALL approved reviews, and no customer, order, phone or email', async () => {
  world.review({ rating: 5, body: 'Oldest', createdAt: new Date('2026-11-01T10:00:00Z'), order: '65a0000000000000000a0011' });
  world.review({ rating: 3, body: 'Newest', createdAt: new Date('2026-11-10T10:00:00Z'), order: '65a0000000000000000a0012', reply: { text: 'Thank you!', at: new Date('2026-11-11T10:00:00Z') } });
  world.review({ rating: 1, body: 'Hidden by an admin', status: 'rejected', hiddenReason: 'Abusive', order: '65a0000000000000000a0013' });
  world.review({ rating: 1, body: 'Pending is not used', status: 'pending', order: '65a0000000000000000a0014' });
  world.review({ rating: 4, body: 'Another product', product: PRODUCT_P2, order: '65a0000000000000000a0015' });
  const res = await list();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, s-maxage=30, stale-while-revalidate=120');
  const body = await json(res);
  assert.deepEqual(body.data.reviews.map((r: Row) => r.body), ['Newest', 'Oldest']);
  assert.deepEqual(body.data.summary, { average: 4, count: 2 });
  assert.equal(body.page, 1);
  assert.equal(body.totalPages, 1);
  assert.deepEqual(body.data.reviews[0].reply, { text: 'Thank you!', at: '2026-11-11T10:00:00.000Z' });
  assert.equal(body.data.reviews[1].reply, null);
  const text = JSON.stringify(body);
  for (const secret of ['Hidden by an admin', 'Abusive', 'status', 'customer', 'order', PHONE, 'hiddenReason', 'Another product']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(Object.keys(body.data.reviews[0]).sort(), ['body', 'createdAt', 'displayName', 'id', 'rating', 'reply', 'title', 'verified']);
});

test('the public list is paged: limit and page, the totals are of all approved reviews, and a bad page or limit is a 400', async () => {
  for (let index = 0; index < 5; index += 1) world.review({ rating: 5, body: 'Review ' + index, createdAt: new Date(Date.UTC(2026, 10, 1 + index)), order: '65a0000000000000000a01' + String(index).padStart(2, '0') });
  const first = await json(await list('shirt', '?limit=2&page=1'));
  assert.deepEqual(first.data.reviews.map((r: Row) => r.body), ['Review 4', 'Review 3']);
  assert.equal(first.totalPages, 3);
  assert.equal(first.data.summary.count, 5);
  const last = await json(await list('shirt', '?limit=2&page=3'));
  assert.deepEqual(last.data.reviews.map((r: Row) => r.body), ['Review 0']);
  for (const query of ['?page=0', '?limit=0', '?limit=51', '?page=abc', '?sort=asc']) assert.equal((await list('shirt', query)).status, 400, query);
});

test('a product with no review has an empty list and a count of 0; a draft, an unknown slug and another store\'s product are the same 404', async () => {
  const empty = await json(await list());
  assert.deepEqual(empty.data, { reviews: [], summary: { average: 0, count: 0 } });
  world.products.push({ _id: '65a0000000000000000c0077', store: STORE_A, slug: 'draft', title: 'Draft', isPublished: false, isDemo: false, deletedAt: null, moderation: null });
  world.products.push({ _id: '65a0000000000000000c0078', store: STORE_B, slug: 'foreign', title: 'Foreign', isPublished: true, isDemo: false, deletedAt: null, moderation: null });
  const statuses = [(await list('draft')).status, (await list('nope-nope')).status, (await list('foreign')).status];
  assert.deepEqual(statuses, [404, 404, 404]);
});

test('the public list is rate limited per address (a wider limit than the writes)', async () => {
  await inSafeWindow();
  let refusedAt = 0;
  for (let call = 1; call <= 125; call += 1) {
    const res = await list('shirt', '', STORE_A, { 'x-forwarded-for': '198.51.100.9' });
    if (res.status === 429 && refusedAt === 0) refusedAt = call;
  }
  assert.equal(refusedAt, 121);
});

test('publishing a review purges the product\'s cache tag, so the storefront shows it', async () => {
  world.deliveredOrder();
  const saved = { fetch: globalThis.fetch };
  const purged: string[][] = [];
  process.env.STOREFRONT_URL = 'http://storefront.test';
  process.env.REVALIDATE_SECRET = 'purge-secret-purge-secret';
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    purged.push(JSON.parse(String(init.body)).tags);
    return new Response('{}');
  }) as typeof fetch;
  try {
    assert.equal((await review()).status, 201);
    await settleRevalidations();
    assert.equal(purged.length, 1);
    assert.ok(purged[0]!.includes('store:' + STORE_A + ':product:shirt'), purged[0]!.join(','));
    assert.ok(purged[0]!.includes('store:' + STORE_A + ':products'));
  } finally {
    globalThis.fetch = saved.fetch;
    delete process.env.STOREFRONT_URL;
    delete process.env.REVALIDATE_SECRET;
  }
});

test('a returned order (everything came back) keeps its delivery on record, so its items can still be reviewed', async () => {
  world.deliveredOrder({ status: 'returned', statusHistory: [...deliveredOn(new Date(Date.now() - 3 * 86_400_000)), { from: 'delivered', to: 'returned', by: null, at: new Date(), note: null }] });
  assert.equal((await review()).status, 201);
});

test('sendReviewReceived is idempotent: one email and one alert however often it runs', async () => {
  const input = { id: '65a0000000000000000f0abc', productId: PRODUCT_P1, productTitle: 'Shirt', rating: 5, body: 'Nice', displayName: 'Sana' };
  await sendReviewReceived(STORE_A, input);
  await sendReviewReceived(STORE_A, input);
  assert.equal(world.alerts.filter((a) => a.kind === 'review_received').length, 1);
  assert.equal(world.outbox.filter((row) => row.template === 'review_received_seller').length, 1);
});
