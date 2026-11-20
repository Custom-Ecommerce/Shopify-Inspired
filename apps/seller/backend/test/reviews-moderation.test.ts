import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { settleRevalidations } from '../src/lib/revalidate';
import { ADMIN, STORE_A, STORE_B, type Row } from './helpers/returns-world';
import { PRODUCT_P1, installReviewsWorld, type ReviewsWorld } from './helpers/reviews-world';

// Sprint 5 EP-21.US01.T05 (D-108): the admin hides a review with a reason and shows it again. Served to the admin console under
// /api/internal/moderation/reviews (signed with MODERATION_API_SECRET, like the product moderation), and the seller backend owns the write: ONE
// compare-and-set on the status that was read, an audit entry that holds ids only, the product's average and count recomputed, and the storefront's
// cache tag for the product purged. Models are in memory (./helpers/reviews-world).

const MOD_SECRET = 'm'.repeat(40);
let world: ReviewsWorld;
let listGET: (request: NextRequest) => Promise<Response>;
let hidePOST: (request: NextRequest) => Promise<Response>;
let unhidePOST: (request: NextRequest) => Promise<Response>;
let savedEnv: Record<string, string | undefined> = {};

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  listGET = (await import('../src/app/api/internal/moderation/reviews/route')).GET;
  hidePOST = (await import('../src/app/api/internal/moderation/reviews/hide/route')).POST;
  unhidePOST = (await import('../src/app/api/internal/moderation/reviews/unhide/route')).POST;
});

beforeEach(() => {
  world = installReviewsWorld();
  savedEnv = { mod: process.env.MODERATION_API_SECRET, url: process.env.STOREFRONT_URL, secret: process.env.REVALIDATE_SECRET };
  process.env.MODERATION_API_SECRET = MOD_SECRET;
});

afterEach(() => {
  world.restore();
  for (const [name, key] of [['mod', 'MODERATION_API_SECRET'], ['url', 'STOREFRONT_URL'], ['secret', 'REVALIDATE_SECRET']] as const) {
    if (savedEnv[name] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[name];
  }
});

function signed(path: string, input?: unknown, query = ''): NextRequest {
  const body = input === undefined ? '' : JSON.stringify(input);
  const method = input === undefined ? 'GET' : 'POST';
  const full = '/api/internal/moderation/reviews' + path + query;
  return new NextRequest('http://seller.test' + full, {
    method,
    headers: internalRequestHeaders(MOD_SECRET, { method, path: full, adminId: ADMIN, body }),
    ...(input === undefined ? {} : { body }),
  });
}

const json = async (res: Response) => (await res.json()) as any;
const stored = (id: unknown): Row => world.reviews.find((r) => String(r._id) === String(id))!;

function seed(): { a: Row; b: Row; foreign: Row } {
  const a = world.review({ rating: 5, body: 'Great', order: '65a0000000000000000a0031' });
  const b = world.review({ rating: 3, body: 'Fine', order: '65a0000000000000000a0032' });
  const foreign = world.review({ store: STORE_B, rating: 1, body: 'Bad', product: '65a0000000000000000c0099', order: '65a0000000000000000a0033' });
  return { a, b, foreign };
}

test('a request without a valid signature is 401 and changes nothing; without the secret set the routes are closed (503)', async () => {
  const { a } = seed();
  const unsigned = new NextRequest('http://seller.test/api/internal/moderation/reviews/hide', { method: 'POST', body: JSON.stringify({ reviewId: String(a._id), reason: 'Abusive' }) });
  assert.equal((await hidePOST(unsigned)).status, 401);
  const wrong = new NextRequest('http://seller.test/api/internal/moderation/reviews/hide', {
    method: 'POST',
    headers: internalRequestHeaders('w'.repeat(40), { method: 'POST', path: '/api/internal/moderation/reviews/hide', adminId: ADMIN, body: JSON.stringify({ reviewId: String(a._id), reason: 'Abusive' }) }),
    body: JSON.stringify({ reviewId: String(a._id), reason: 'Abusive' }),
  });
  assert.equal((await hidePOST(wrong)).status, 401);
  assert.equal(stored(a._id).status, 'approved');
  delete process.env.MODERATION_API_SECRET;
  assert.equal((await hidePOST(signed('/hide', { reviewId: String(a._id), reason: 'Abusive' }))).status, 503);
  assert.equal((await listGET(signed(''))).status, 503);
});

test('hide: status rejected with the reason, the time and the operator; the answer is the operator\'s view (the store and the product named, the shopper only by the name they chose)', async () => {
  const { a } = seed();
  const res = await hidePOST(signed('/hide', { reviewId: String(a._id), reason: 'Abusive language' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await json(res);
  assert.equal(body.status, 'rejected');
  assert.equal(body.hiddenReason, 'Abusive language');
  assert.ok(body.hiddenAt);
  assert.equal(body.storeName, 'Zara Lawn');
  assert.equal(body.productTitle, 'Shirt');
  assert.equal(body.displayName, 'Ayesha K.');
  assert.equal(stored(a._id).status, 'rejected');
  assert.equal(stored(a._id).hiddenReason, 'Abusive language');
  assert.equal(String(stored(a._id).hiddenBy), ADMIN);
  const text = JSON.stringify(body);
  for (const field of ['customer', 'phone', 'email', 'order"']) assert.equal(text.includes(field), false, field);
});

test('a hidden review leaves the product\'s average and count (the storefront list reads approved only), and the product page is purged', async () => {
  const { a, b } = seed();
  world.products.find((p) => p._id === PRODUCT_P1)!.reviewCount = 2;
  const purged: string[][] = [];
  const saved = globalThis.fetch;
  process.env.STOREFRONT_URL = 'http://storefront.test';
  process.env.REVALIDATE_SECRET = 'purge-secret-purge-secret';
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    purged.push(JSON.parse(String(init.body)).tags);
    return new Response('{}');
  }) as typeof fetch;
  try {
    assert.equal((await hidePOST(signed('/hide', { reviewId: String(a._id), reason: 'Abusive language' }))).status, 200);
    await settleRevalidations();
    assert.deepEqual(world.productWrites.map((w) => [w.avgRating, w.reviewCount]), [[3, 1]], 'only the 3 star review counts now');
    assert.equal(purged.length, 1, 'revalidation called');
    assert.ok(purged[0]!.includes('store:' + STORE_A + ':product:shirt'));

    assert.equal((await unhidePOST(signed('/unhide', { reviewId: String(a._id) }))).status, 200);
    await settleRevalidations();
    assert.deepEqual(world.productWrites.map((w) => [w.avgRating, w.reviewCount]), [[3, 1], [4, 2]], 'shown again: both count');
    assert.equal(purged.length, 2);
    assert.equal(stored(b._id).status, 'approved');
  } finally {
    globalThis.fetch = saved;
  }
});

test('unhide: status approved, the reason, the time and the operator cleared; a repeat of either action is a no-op that answers the same review', async () => {
  const { a } = seed();
  assert.equal((await hidePOST(signed('/hide', { reviewId: String(a._id), reason: 'Abusive language' }))).status, 200);
  const again = await hidePOST(signed('/hide', { reviewId: String(a._id), reason: 'A different reason' }));
  assert.equal(again.status, 200);
  assert.equal(stored(a._id).hiddenReason, 'Abusive language', 'the first hide stands');
  assert.equal(world.audits.filter((x) => x.action === 'review.hide').length, 1, 'a repeat writes no second entry');

  const shown = await unhidePOST(signed('/unhide', { reviewId: String(a._id) }));
  assert.equal(shown.status, 200);
  assert.equal((await json(shown)).status, 'approved');
  assert.equal(stored(a._id).status, 'approved');
  assert.equal(stored(a._id).hiddenReason, null);
  assert.equal(stored(a._id).hiddenAt, null);
  assert.equal(stored(a._id).hiddenBy, null);
  assert.equal((await unhidePOST(signed('/unhide', { reviewId: String(a._id) }))).status, 200);
  assert.equal(world.audits.filter((x) => x.action === 'review.unhide').length, 1);
});

test('the audit entry holds ids and the time only: never the reason text, the review text, a name, a phone or an email', async () => {
  const { a } = seed();
  await hidePOST(signed('/hide', { reviewId: String(a._id), reason: 'Contains the phone 0300 1234567 and a@b.pk' }));
  await unhidePOST(signed('/unhide', { reviewId: String(a._id) }));
  const entries = world.audits.filter((x) => String(x.action).startsWith('review.'));
  assert.deepEqual(entries.map((x) => x.action), ['review.hide', 'review.unhide']);
  assert.ok(entries.every((x) => x.actorId === 'admin:' + ADMIN));
  const text = JSON.stringify(entries);
  for (const secret of ['Contains the phone', '0300', 'a@b.pk', 'Great', 'Ayesha']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(Object.keys(entries[0]!.details).sort(), ['at', 'productId', 'reviewId', 'storeId']);
});

test('the reason is required and plain: missing, short, long or an unknown field is 422 and nothing changes; an unknown review is 404', async () => {
  const { a } = seed();
  const cases: unknown[] = [
    { reviewId: String(a._id) },
    { reviewId: String(a._id), reason: 'no' },
    { reviewId: String(a._id), reason: '   ' },
    { reviewId: String(a._id), reason: 'x'.repeat(301) },
    { reviewId: String(a._id), reason: 'Abusive', status: 'approved' },
    { reviewId: 'nope', reason: 'Abusive' },
  ];
  for (const input of cases) assert.equal((await hidePOST(signed('/hide', input))).status, 422, JSON.stringify(input));
  assert.equal(stored(a._id).status, 'approved');
  assert.equal((await hidePOST(signed('/hide', { reviewId: '65a0000000000000000fffff', reason: 'Abusive' }))).status, 404);
  assert.equal((await unhidePOST(signed('/unhide', { reviewId: '65a0000000000000000fffff' }))).status, 404);
  assert.equal(world.audits.length, 0);
});

test('the admin list is across stores, newest first, paged, filtered by store and by status, and names the store and the product', async () => {
  const { a, b, foreign } = seed();
  await hidePOST(signed('/hide', { reviewId: String(b._id), reason: 'Abusive' }));
  const all = await json(await listGET(signed('')));
  assert.equal(all.totalDocs, 3);
  assert.deepEqual(all.docs.map((d: Row) => d.reviewId).sort(), [a, b, foreign].map((r) => String(r._id)).sort());
  assert.equal(all.docs.find((d: Row) => d.reviewId === String(foreign._id)).storeName, 'Bilal Shoes');
  const hidden = await json(await listGET(signed('', undefined, '?status=rejected')));
  assert.deepEqual(hidden.docs.map((d: Row) => d.reviewId), [String(b._id)]);
  const store = await json(await listGET(signed('', undefined, '?storeId=' + STORE_B)));
  assert.deepEqual(store.docs.map((d: Row) => d.reviewId), [String(foreign._id)]);
  const paged = await json(await listGET(signed('', undefined, '?limit=2&page=2')));
  assert.equal(paged.docs.length, 1);
  assert.equal(paged.totalPages, 2);
  for (const query of ['?status=pending', '?limit=51', '?page=0', '?storeId=nope', '?x=1']) assert.equal((await listGET(signed('', undefined, query))).status, 422, query);
});
