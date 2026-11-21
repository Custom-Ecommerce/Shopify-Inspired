import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { assertCan, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { ADMIN, SECRET, STORE_A, STORE_B, USER_A, USER_B, type Row } from './helpers/returns-world';
import { PRODUCT_P1, PRODUCT_P2, installReviewsWorld, type ReviewsWorld } from './helpers/reviews-world';

// Sprint 5 EP-21.US02.T01 and T03 (D-108): the seller's review routes under /api/reviews. The list has ?status= (the tabs used to send
// where[status][equals], which the backend never read) and ?unanswered=1 and pages; the seller keeps ONLY the reply (POST once, PATCH to edit) and
// loses the status change; a foreign store id is 403 and a foreign review id is 404; every reply is audited without its text and drops the product's
// cache tag. Models are in memory (./helpers/reviews-world).

type Ctx = { params: Promise<{ id: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let world: ReviewsWorld;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let listGET: (request: NextRequest) => Promise<Response>;
let itemGET: Handler;
let itemPATCH: Handler;
let replyPOST: Handler;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  listGET = (await import('../src/app/api/reviews/route')).GET;
  const item = (await import('../src/app/api/reviews/[id]/route')) as any;
  itemGET = item.GET;
  itemPATCH = item.PATCH;
  replyPOST = (await import('../src/app/api/reviews/[id]/reply/route')).POST as Handler;
});

beforeEach(() => {
  world = installReviewsWorld();
});

afterEach(() => world.restore());

function request(method: string, path: string, options: { token?: string | null; store?: string; body?: unknown } = {}): NextRequest {
  const token = options.token === undefined ? tokenA : options.token;
  const headers: Record<string, string> = { 'x-store-id': options.store ?? STORE_A };
  if (token) headers.authorization = 'Bearer ' + token;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest('http://seller.test/api/reviews' + path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}

const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => (await res.json()) as any;
const stored = (id: unknown): Row => world.reviews.find((r) => String(r._id) === String(id))!;

function seed(): { shown: Row; hidden: Row; answered: Row; foreign: Row } {
  const shown = world.review({ rating: 5, body: 'Shown and unanswered', createdAt: new Date('2026-11-10T10:00:00Z') });
  const hidden = world.review({ rating: 1, body: 'Hidden by an admin', status: 'rejected', hiddenReason: 'Abusive language', createdAt: new Date('2026-11-09T10:00:00Z'), order: '65a0000000000000000a0021' });
  const answered = world.review({ rating: 4, body: 'Shown and answered', product: PRODUCT_P2, reply: { text: 'Thank you!', at: new Date('2026-11-11T10:00:00Z'), editedAt: null }, createdAt: new Date('2026-11-08T10:00:00Z'), order: '65a0000000000000000a0022' });
  const foreign = world.review({ store: STORE_B, body: 'Foreign review', createdAt: new Date('2026-11-12T10:00:00Z'), order: '65a0000000000000000a0023' });
  return { shown, hidden, answered, foreign };
}

// ----------------------------------------------------------------------------------------------------------------------- the list

test('the list is the store\'s own reviews, newest first, built field by field: the product\'s title, no customer, order, phone or email', async () => {
  const { foreign } = seed();
  const res = await listGET(request('GET', ''));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await json(res);
  assert.equal(body.totalDocs, 3);
  assert.deepEqual(body.docs.map((d: Row) => d.body), ['Shown and unanswered', 'Hidden by an admin', 'Shown and answered']);
  assert.equal(JSON.stringify(body).includes('Foreign review'), false);
  assert.equal(JSON.stringify(body).includes(String(foreign._id)), false);
  const first = body.docs[0];
  assert.deepEqual(Object.keys(first).sort(), ['body', 'createdAt', 'displayName', 'hiddenReason', 'id', 'product', 'rating', 'reply', 'status', 'title', 'verified']);
  assert.deepEqual(first.product, { id: PRODUCT_P1, title: 'Shirt', slug: 'shirt' });
  const text = JSON.stringify(body);
  for (const field of ['customer', 'order', 'phone', 'email', 'hiddenBy']) assert.equal(text.includes('"' + field + '"'), false, field);
});

test('?status= filters (the dead tabs now work), ?unanswered=1 keeps what has no reply, and they combine', async () => {
  seed();
  const bodiesOf = async (query: string): Promise<string[]> => (await json(await listGET(request('GET', query)))).docs.map((d: Row) => d.body);
  assert.deepEqual(await bodiesOf('?status=approved'), ['Shown and unanswered', 'Shown and answered']);
  assert.deepEqual(await bodiesOf('?status=rejected'), ['Hidden by an admin']);
  assert.deepEqual(await bodiesOf('?unanswered=1'), ['Shown and unanswered', 'Hidden by an admin']);
  assert.deepEqual(await bodiesOf('?status=approved&unanswered=1'), ['Shown and unanswered']);
  assert.deepEqual(await bodiesOf('?status=pending'), []);
  // The old query the page sent is simply not a filter: it changes nothing.
  assert.equal((await bodiesOf('?where[status][equals]=rejected')).length, 3);
});

test('the list is paged and refuses a filter that is not one', async () => {
  seed();
  const first = await json(await listGET(request('GET', '?limit=2&page=1')));
  assert.equal(first.docs.length, 2);
  assert.equal(first.totalDocs, 3);
  assert.equal(first.totalPages, 2);
  const second = await json(await listGET(request('GET', '?limit=2&page=2')));
  assert.equal(second.docs.length, 1);
  assert.equal((await listGET(request('GET', '?status=maybe'))).status, 422);
  assert.equal((await listGET(request('GET', '?unanswered=yes'))).status, 422);
});

test('no login is 401; Seller B naming Seller A\'s store is 403 on the list, the detail, the reply and the edit; an admin cannot reply', async () => {
  const { shown, foreign } = seed();
  assert.equal((await listGET(request('GET', '', { token: null }))).status, 401);
  assert.equal((await listGET(request('GET', '', { token: tokenB, store: STORE_A }))).status, 403);
  assert.equal((await itemGET(request('GET', '/' + shown._id, { token: tokenB, store: STORE_A }), ctx(String(shown._id)))).status, 403);
  assert.equal((await replyPOST(request('POST', '/' + shown._id + '/reply', { token: tokenB, store: STORE_A, body: { reply: 'Hacked' } }), ctx(String(shown._id)))).status, 403);
  assert.equal((await itemPATCH(request('PATCH', '/' + shown._id, { token: tokenB, store: STORE_A, body: { reply: 'Hacked' } }), ctx(String(shown._id)))).status, 403);
  assert.equal((await replyPOST(request('POST', '/' + shown._id + '/reply', { token: tokenAdmin, body: { reply: 'From an admin' } }), ctx(String(shown._id)))).status, 403);
  assert.equal(stored(shown._id).reply, null);
  assert.equal(stored(foreign._id).reply, null);
});

// ------------------------------------------------------------------------------------------------------------------------ the reply

test('the status change is gone: PATCH { status } is refused with 400 and the review is untouched, for a shown and a hidden review', async () => {
  const { shown, hidden } = seed();
  for (const review of [shown, hidden]) {
    const before = stored(review._id).status;
    for (const status of ['approved', 'rejected', 'pending']) {
      const res = await itemPATCH(request('PATCH', '/' + review._id, { body: { status } }), ctx(String(review._id)));
      assert.equal(res.status, 400, status);
      // The body has no reply, so the first problem named is the missing reply; the unknown status is refused too (strict).
      assert.ok(['reply', 'status'].includes((await json(res)).field), 'a field is named');
    }
    assert.equal(stored(review._id).status, before);
  }
  assert.equal(stored(hidden._id).hiddenReason, 'Abusive language', 'a seller cannot clear an admin\'s hide');
});

test('the policy: a seller may update the reply only, an admin and the system may update the rest, create is the system\'s', () => {
  assert.doesNotThrow(() => assertCan('seller', 'update', 'reviews', ['reply']));
  for (const field of ['status', 'body', 'rating', 'hiddenReason', 'displayName', 'verified', 'store']) assert.throws(() => assertCan('seller', 'update', 'reviews', [field]), field);
  assert.doesNotThrow(() => assertCan('admin', 'update', 'reviews', ['status', 'hiddenReason', 'hiddenAt', 'hiddenBy']));
  assert.doesNotThrow(() => assertCan('system', 'create', 'reviews', ['product', 'store', 'order', 'rating', 'body']));
  assert.throws(() => assertCan('seller', 'create', 'reviews', ['body']));
  assert.throws(() => assertCan('public', 'create', 'reviews', ['body']));
});

test('a reply is written ONCE (POST), up to 500 characters of plain text, the second POST is 409 and the first reply stands', async () => {
  const { shown } = seed();
  const res = await replyPOST(request('POST', '/' + shown._id + '/reply', { body: { reply: '  Thank you, Ayesha!  ' } }), ctx(String(shown._id)));
  assert.equal(res.status, 201);
  const body = await json(res);
  assert.equal(body.reply.text, 'Thank you, Ayesha!');
  assert.equal(body.reply.editedAt, null);
  assert.ok(body.reply.at);
  assert.equal(stored(shown._id).reply.text, 'Thank you, Ayesha!');

  const again = await replyPOST(request('POST', '/' + shown._id + '/reply', { body: { reply: 'A second reply' } }), ctx(String(shown._id)));
  assert.equal(again.status, 409);
  assert.equal((await json(again)).code, 'REVIEW_ALREADY_REPLIED');
  assert.equal(stored(shown._id).reply.text, 'Thank you, Ayesha!');
});

test('two parallel first replies: one wins, the loser is 409 REVIEW_ALREADY_REPLIED (one compare-and-set on reply: null)', async () => {
  const { shown } = seed();
  const answers = await Promise.all(['First', 'Second'].map((text) => replyPOST(request('POST', '/' + shown._id + '/reply', { body: { reply: text } }), ctx(String(shown._id)))));
  assert.deepEqual(answers.map((res) => res.status).sort(), [201, 409]);
  assert.ok(['First', 'Second'].includes(stored(shown._id).reply.text));
});

test('the reply is editable (PATCH): the text changes, editedAt is set, the first date stays; the edit of a review with no reply is 409 REVIEW_NOT_REPLIED', async () => {
  const { shown, answered } = seed();
  const none = await itemPATCH(request('PATCH', '/' + shown._id, { body: { reply: 'Nothing to edit yet' } }), ctx(String(shown._id)));
  assert.equal(none.status, 409);
  assert.equal((await json(none)).code, 'REVIEW_NOT_REPLIED');
  assert.equal(stored(shown._id).reply, null);

  const firstAt = stored(answered._id).reply.at;
  const res = await itemPATCH(request('PATCH', '/' + answered._id, { body: { reply: 'Thank you so much!' } }), ctx(String(answered._id)));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.reply.text, 'Thank you so much!');
  assert.ok(body.reply.editedAt);
  assert.equal(new Date(body.reply.at).getTime(), new Date(firstAt).getTime());
});

test('the reply is validated: empty, over 500 characters, or any other field is a 400 naming the field, and nothing is written', async () => {
  const { shown } = seed();
  const cases: Array<[unknown, string]> = [
    [{ reply: '' }, 'reply'],
    [{ reply: '   ' }, 'reply'],
    [{ reply: 'x'.repeat(501) }, 'reply'],
    [{}, 'reply'],
    [{ reply: 'ok', rating: 1 }, 'rating'],
    [{ reply: 'ok', body: 'edited' }, 'body'],
  ];
  for (const [body, field] of cases) {
    const res = await replyPOST(request('POST', '/' + shown._id + '/reply', { body }), ctx(String(shown._id)));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await json(res)).field, field, JSON.stringify(body));
  }
  assert.equal(stored(shown._id).reply, null);
  assert.equal((await replyPOST(request('POST', '/' + shown._id + '/reply', { body: { reply: 'x'.repeat(500) } }), ctx(String(shown._id)))).status, 201);
});

test('a foreign review id is 404 (never leaked), a malformed id is 404 for the reply, and the review is untouched', async () => {
  const { foreign } = seed();
  const res = await replyPOST(request('POST', '/' + foreign._id + '/reply', { body: { reply: 'Not mine' } }), ctx(String(foreign._id)));
  assert.equal(res.status, 404);
  assert.equal(JSON.stringify(await json(res)).includes('Foreign review'), false);
  assert.equal(stored(foreign._id).reply, null);
  assert.equal((await replyPOST(request('POST', '/nope/reply', { body: { reply: 'x' } }), ctx('nope'))).status, 404);
  assert.equal((await itemPATCH(request('PATCH', '/' + foreign._id, { body: { reply: 'Not mine' } }), ctx(String(foreign._id)))).status, 404);
  assert.equal((await itemGET(request('GET', '/' + foreign._id), ctx(String(foreign._id)))).status, 404);
});

test('a reply and an edit are audited with ids and the time only: never the reply text, a name, a phone or an email', async () => {
  const { shown } = seed();
  assert.equal((await replyPOST(request('POST', '/' + shown._id + '/reply', { body: { reply: 'Secret words 0300 1234567 a@b.pk' } }), ctx(String(shown._id)))).status, 201);
  assert.equal((await itemPATCH(request('PATCH', '/' + shown._id, { body: { reply: 'Edited secret words' } }), ctx(String(shown._id)))).status, 200);
  const entries = world.audits.filter((a) => String(a.action).startsWith('review.'));
  assert.deepEqual(entries.map((a) => a.action), ['review.reply', 'review.reply_edit']);
  const text = JSON.stringify(entries);
  for (const secret of ['Secret words', 'Edited secret', '0300', 'a@b.pk', 'Ayesha']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(Object.keys(entries[0]!.details).sort(), ['at', 'productId', 'reviewId', 'storeId']);
});

test('a reply to a review the admin hid is allowed (it is the seller\'s words) and does not change the status', async () => {
  const { hidden } = seed();
  assert.equal((await replyPOST(request('POST', '/' + hidden._id + '/reply', { body: { reply: 'We are sorry' } }), ctx(String(hidden._id)))).status, 201);
  assert.equal(stored(hidden._id).status, 'rejected');
  assert.equal(stored(hidden._id).hiddenReason, 'Abusive language');
});

test('the detail is one review as the seller reads it, with its hidden reason', async () => {
  const { hidden } = seed();
  const body = await json(await itemGET(request('GET', '/' + hidden._id), ctx(String(hidden._id))));
  assert.equal(body.status, 'rejected');
  assert.equal(body.hiddenReason, 'Abusive language');
  assert.equal(body.product.title, 'Shirt');
});
