import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_BODY_MAX,
  REVIEW_INELIGIBLE_MESSAGES,
  REVIEW_INELIGIBLE_REASONS,
  REVIEW_REPLY_MAX,
  REVIEW_STATUSES,
  cleanReviewText,
  productReviewsQuerySchema,
  productReviewsResponseSchema,
  reviewCreateRequestSchema,
  reviewEligibilitySchema,
  reviewHideRequestSchema,
  reviewModerationListQuerySchema,
  reviewReplyRequestSchema,
  reviewSchema,
  reviewUnhideRequestSchema,
  sellerReviewListQuerySchema,
} from '../src/review';
import { SELLER_ALERT_KINDS } from '../src/notifications';
import { STOREFRONT_ERROR_CODES } from '../src/storefront';
import { storeMessagesUpdateSchema, storeSettingsSchema } from '../src/store-settings';
import { failingPaths } from './helpers';

// Sprint 5 EP-21 (D-107, D-108): the review contract: the status values keep their words, the create request (plain text, bounded, strict), the seller's
// reply, the admin's hide and unhide, the public list, and what the batch adds elsewhere (the alert kind, the error code, the settings switch).

const PRODUCT = '65a0000000000000000c0001';
const create = { phone: '0300 1234567', productId: PRODUCT, rating: 5, body: 'Soft fabric, true to size.', displayName: 'Ayesha K.' };
const createFailing = (fields: Record<string, unknown>): string[] => failingPaths(reviewCreateRequestSchema.safeParse({ ...create, ...fields }));

test('the statuses keep their three values: approved = shown, rejected = hidden by an admin, pending unused', () => {
  assert.deepEqual([...REVIEW_STATUSES], ['pending', 'approved', 'rejected']);
  const base = { id: PRODUCT, product: PRODUCT, store: PRODUCT, rating: 4, body: 'Good', createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z' };
  for (const status of REVIEW_STATUSES) assert.equal(reviewSchema.safeParse({ ...base, status }).success, true, status);
  assert.equal(reviewSchema.safeParse({ ...base, status: 'maybe' }).success, false, 'the status is no longer a loose string');
  assert.equal(
    reviewSchema.safeParse({ ...base, displayName: 'Ayesha K.', verified: true, reply: { text: 'Thanks', at: '2026-11-21T10:00:00.000Z' }, hiddenReason: null }).success,
    true,
    'the new fields: name, verified, reply, hidden reason',
  );
});

test('a create request: the phone, the product, a rating from 1 to 5, the text and the name; the title and the name are optional', () => {
  assert.equal(reviewCreateRequestSchema.safeParse(create).success, true);
  assert.equal(reviewCreateRequestSchema.safeParse({ ...create, title: 'Lovely' }).success, true);
  assert.equal(reviewCreateRequestSchema.safeParse({ ...create, title: null, displayName: null }).success, true);
  const { displayName: _name, ...withoutName } = create;
  void _name;
  assert.equal(reviewCreateRequestSchema.safeParse(withoutName).success, true);
  for (const field of ['phone', 'productId', 'rating', 'body']) {
    const rest: Record<string, unknown> = { ...create };
    delete rest[field];
    assert.deepEqual(failingPaths(reviewCreateRequestSchema.safeParse(rest)), [field], field);
  }
});

test('the fields are bounded: rating 1 to 5 whole, the text 5 to 1000, the title 80, the name 40, the product an ObjectId', () => {
  assert.deepEqual(createFailing({ rating: 0 }), ['rating']);
  assert.deepEqual(createFailing({ rating: 6 }), ['rating']);
  assert.deepEqual(createFailing({ rating: 3.5 }), ['rating']);
  assert.deepEqual(createFailing({ body: 'four' }), ['body']);
  assert.deepEqual(createFailing({ body: 'x'.repeat(REVIEW_BODY_MAX + 1) }), ['body']);
  assert.deepEqual(createFailing({ title: 'x'.repeat(81) }), ['title']);
  assert.deepEqual(createFailing({ displayName: 'x'.repeat(41) }), ['displayName']);
  assert.deepEqual(createFailing({ productId: 'not-an-id' }), ['productId']);
  assert.deepEqual(createFailing({ body: '   ' }), ['body'], 'spaces do not count');
  assert.equal(reviewCreateRequestSchema.safeParse({ ...create, body: 'x'.repeat(REVIEW_BODY_MAX), title: 'y'.repeat(80), displayName: 'z'.repeat(40) }).success, true);
});

test('strict: an unknown field (a status, a customer, a verified flag) is refused, so the shopper can never set what only the server sets', () => {
  for (const extra of [{ status: 'approved' }, { verified: true }, { customer: PRODUCT }, { order: PRODUCT }, { store: PRODUCT }]) {
    assert.equal(reviewCreateRequestSchema.safeParse({ ...create, ...extra }).success, false, JSON.stringify(extra));
  }
});

test('text is plain text kept as typed: control characters are cleaned, the ends trimmed, a tag stays text, never refused', () => {
  const parsed = reviewCreateRequestSchema.parse({ ...create, body: '  <b>Great</b>\u0000 fabric\r\nsecond line  ', title: '\u0007Nice\u0008', displayName: ' Ayesha ' });
  assert.equal(parsed.body, '<b>Great</b> fabric\nsecond line');
  assert.equal(parsed.title, 'Nice');
  assert.equal(parsed.displayName, 'Ayesha');
  assert.equal(cleanReviewText('a\tb\nc'), 'a\tb\nc', 'tabs and line breaks stay');
  assert.equal(cleanReviewText('\u007Fx\u0000'), 'x');
});

test('the seller\'s reply: 1 to 500 characters of plain text, nothing else', () => {
  assert.equal(reviewReplyRequestSchema.safeParse({ reply: 'Thank you!' }).success, true);
  assert.equal(reviewReplyRequestSchema.safeParse({ reply: 'x'.repeat(REVIEW_REPLY_MAX) }).success, true);
  assert.deepEqual(failingPaths(reviewReplyRequestSchema.safeParse({ reply: '' })), ['reply']);
  assert.deepEqual(failingPaths(reviewReplyRequestSchema.safeParse({ reply: '   ' })), ['reply']);
  assert.deepEqual(failingPaths(reviewReplyRequestSchema.safeParse({ reply: 'x'.repeat(REVIEW_REPLY_MAX + 1) })), ['reply']);
  assert.deepEqual(failingPaths(reviewReplyRequestSchema.safeParse({})), ['reply']);
  for (const extra of [{ status: 'approved' }, { body: 'edited' }, { rating: 1 }]) assert.equal(reviewReplyRequestSchema.safeParse({ reply: 'ok', ...extra }).success, false, JSON.stringify(extra));
});

test('the admin\'s hide needs a review id and a reason of 3 to 300 characters; unhide needs only the id; both are strict', () => {
  assert.equal(reviewHideRequestSchema.safeParse({ reviewId: PRODUCT, reason: 'Abusive language' }).success, true);
  assert.deepEqual(failingPaths(reviewHideRequestSchema.safeParse({ reviewId: PRODUCT })), ['reason']);
  assert.deepEqual(failingPaths(reviewHideRequestSchema.safeParse({ reviewId: PRODUCT, reason: 'no' })), ['reason']);
  assert.deepEqual(failingPaths(reviewHideRequestSchema.safeParse({ reviewId: PRODUCT, reason: 'x'.repeat(301) })), ['reason']);
  assert.deepEqual(failingPaths(reviewHideRequestSchema.safeParse({ reviewId: 'nope', reason: 'Abusive' })), ['reviewId']);
  assert.equal(reviewHideRequestSchema.safeParse({ reviewId: PRODUCT, reason: 'Abusive', status: 'approved' }).success, false);
  assert.equal(reviewUnhideRequestSchema.safeParse({ reviewId: PRODUCT }).success, true);
  assert.equal(reviewUnhideRequestSchema.safeParse({ reviewId: PRODUCT, reason: 'x' }).success, false);
});

test('the lists: the seller\'s ?status= and ?unanswered=1, the admin\'s filters and the public page, each with its own caps', () => {
  assert.deepEqual(sellerReviewListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.deepEqual(sellerReviewListQuerySchema.parse({ status: 'rejected', unanswered: '1', page: '2', limit: '50' }), { status: 'rejected', unanswered: '1', page: 2, limit: 50 });
  for (const query of [{ status: 'maybe' }, { unanswered: 'yes' }, { limit: '101' }, { page: '0' }, { where: 'x' }]) {
    assert.equal(sellerReviewListQuerySchema.safeParse(query).success, false, JSON.stringify(query));
  }
  assert.deepEqual(productReviewsQuerySchema.parse({}), { page: 1, limit: 10 });
  assert.equal(productReviewsQuerySchema.safeParse({ limit: '51' }).success, false);
  assert.deepEqual(reviewModerationListQuerySchema.parse({ status: 'approved', storeId: PRODUCT }), { page: 1, limit: 20, status: 'approved', storeId: PRODUCT });
  assert.equal(reviewModerationListQuerySchema.safeParse({ status: 'pending' }).success, false, 'an operator filters shown or hidden');
});

test('the answers: the eligibility and the public list read back in their shapes', () => {
  assert.equal(reviewEligibilitySchema.safeParse({ eligible: true, reason: null, items: [{ productId: PRODUCT, productTitle: 'Shirt' }] }).success, true);
  assert.equal(reviewEligibilitySchema.safeParse({ eligible: false, reason: 'not_delivered', items: [] }).success, true);
  assert.equal(reviewEligibilitySchema.safeParse({ eligible: false, reason: 'whatever', items: [] }).success, false);
  assert.deepEqual([...REVIEW_INELIGIBLE_REASONS], ['not_delivered', 'nothing_to_review', 'already_reviewed', 'unknown_product']);
  for (const reason of REVIEW_INELIGIBLE_REASONS) assert.ok(REVIEW_INELIGIBLE_MESSAGES[reason].length > 10, reason);
  const list = {
    data: { reviews: [{ id: 'r1', rating: 5, title: null, body: 'Nice', displayName: 'Ayesha', verified: true, createdAt: '2026-11-20T10:00:00.000Z', reply: null }], summary: { average: 5, count: 1 } },
    page: 1,
    totalPages: 1,
  };
  assert.equal(productReviewsResponseSchema.safeParse(list).success, true);
  assert.equal(productReviewsResponseSchema.safeParse({ ...list, data: { ...list.data, summary: { average: 6, count: 1 } } }).success, false);
});

test('what the batch adds elsewhere: the review_received alert kind, REVIEW_NOT_ELIGIBLE, and the messages switch abandonedCartEmail', () => {
  assert.ok((SELLER_ALERT_KINDS as readonly string[]).includes('review_received'));
  assert.ok((STOREFRONT_ERROR_CODES as readonly string[]).includes('REVIEW_NOT_ELIGIBLE'));
  assert.equal(storeMessagesUpdateSchema.safeParse({ abandonedCartEmail: true }).success, true);
  assert.equal(storeMessagesUpdateSchema.safeParse({ abandonedCartEmail: 'yes' }).success, false);
  assert.equal(storeMessagesUpdateSchema.safeParse({ abandonedCartEmail: false, emailFooter: '' }).success, true);
  const shape = (storeSettingsSchema as unknown as { shape: { messages: { shape: Record<string, unknown> } } }).shape.messages.shape;
  assert.ok('abandonedCartEmail' in shape, 'the answer carries the switch');
});
