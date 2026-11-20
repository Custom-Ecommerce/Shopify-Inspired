import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFUND_METHODS,
  RETURN_NOTE_MAX,
  RETURN_STATUSES,
  RETURN_TRANSITIONS,
  returnCreateRequestSchema,
  returnListQuerySchema,
  returnReceiveRequestSchema,
  returnRefundRequestSchema,
  returnRejectRequestSchema,
  returnStatusUpdateSchema,
} from '../src/return';
import { SELLER_ALERT_KINDS } from '../src/notifications';
import { STOREFRONT_ERROR_CODES } from '../src/storefront';
import { storeReturnsUpdateSchema, storeSettingsUpdateSchema } from '../src/store-settings';
import { failingPaths } from './helpers';

// Sprint 5 EP-13 (D-107, D-108): the return contract: statuses and moves, the create, reject, receive and refund requests, the list query, the
// 'returns' settings group, and the codes the batch adds.

const item = { productId: 'P1', variantId: 'V1', quantity: 1 };

test('the statuses: the five of Sprint 5 and the legacy completed, which stays readable', () => {
  assert.deepEqual([...RETURN_STATUSES], ['requested', 'approved', 'rejected', 'received', 'refunded', 'completed']);
});

test('the moves: requested to approved or rejected, approved to received, received to refunded; nothing leaves the end states', () => {
  assert.deepEqual(RETURN_TRANSITIONS.requested, ['approved', 'rejected']);
  assert.deepEqual(RETURN_TRANSITIONS.approved, ['received']);
  assert.deepEqual(RETURN_TRANSITIONS.received, ['refunded']);
  for (const end of ['rejected', 'refunded', 'completed'] as const) assert.deepEqual(RETURN_TRANSITIONS[end], [], end);
  // Every status has a row, so the table cannot be indexed into nothing.
  for (const status of RETURN_STATUSES) assert.ok(status in RETURN_TRANSITIONS, status);
});

test('the legacy update schema still takes the old fields and now knows the new statuses (the generic route refuses the side-effect moves itself)', () => {
  assert.equal(returnStatusUpdateSchema.safeParse({ status: 'approved', refundType: 'cod_refund', refundAmount: 500 }).success, true);
  assert.equal(returnStatusUpdateSchema.safeParse({ status: 'received' }).success, true);
  assert.equal(returnStatusUpdateSchema.safeParse({}).success, false);
  assert.equal(returnStatusUpdateSchema.safeParse({ order: 'x' }).success, false);
});

// ------------------------------------------------------------------------------------------------------------------- create

test('the create request: phone, one or more lines of productId, variantId and quantity, a reason code and an optional plain note', () => {
  const parsed = returnCreateRequestSchema.parse({ phone: '0300 1234567', items: [item], reasonCode: 'damaged', note: '  It  arrived\n broken ' });
  assert.deepEqual(parsed, { phone: '0300 1234567', items: [item], reasonCode: 'damaged', note: 'It arrived broken' });
  assert.equal(returnCreateRequestSchema.parse({ phone: 'x', items: [item], reasonCode: 'other' }).note, null);
  assert.equal(returnCreateRequestSchema.parse({ phone: 'x', items: [item], reasonCode: 'other', note: '   ' }).note, null);
});

test('the create request refuses what it should and names the field', () => {
  const base = { phone: '03001234567', items: [item], reasonCode: 'damaged' };
  const bad: Array<[unknown, string]> = [
    [{ ...base, phone: undefined }, 'phone'],
    [{ ...base, items: [] }, 'items'],
    [{ ...base, items: undefined }, 'items'],
    [{ ...base, items: [{ ...item, quantity: 0 }] }, 'items.0.quantity'],
    [{ ...base, items: [{ ...item, quantity: 1.5 }] }, 'items.0.quantity'],
    [{ ...base, items: [{ ...item, quantity: 100 }] }, 'items.0.quantity'],
    [{ ...base, items: [{ ...item, variantId: '' }] }, 'items.0.variantId'],
    [{ ...base, items: [{ ...item, price: 1 }] }, 'items.0'],
    [{ ...base, reasonCode: 'broken' }, 'reasonCode'],
    [{ ...base, reasonCode: undefined }, 'reasonCode'],
    [{ ...base, note: 'x'.repeat(RETURN_NOTE_MAX + 1) }, 'note'],
    [{ ...base, note: '<script>' }, 'note'],
    [{ ...base, status: 'approved' }, ''],
  ];
  for (const [value, field] of bad) assert.deepEqual(failingPaths(returnCreateRequestSchema.safeParse(value)).slice(0, 1), [field], JSON.stringify(value));
  assert.equal(returnCreateRequestSchema.safeParse({ ...base, items: Array.from({ length: 51 }, () => item) }).success, false, 'at most 50 lines');
  assert.equal(returnCreateRequestSchema.safeParse({ ...base, note: 'x'.repeat(RETURN_NOTE_MAX) }).success, true);
});

// --------------------------------------------------------------------------------------------------------- reject, receive, refund

test('a rejection needs a reason of 5 to 200 characters of plain text', () => {
  assert.equal(returnRejectRequestSchema.parse({ reason: '  Item was used  ' }).reason, 'Item was used');
  for (const reason of ['', 'no', '    ab    ', 'x'.repeat(201), '<b>bad</b> reason']) {
    assert.deepEqual(failingPaths(returnRejectRequestSchema.safeParse({ reason })), ['reason'], reason);
  }
  assert.equal(returnRejectRequestSchema.safeParse({ reason: 'x'.repeat(200) }).success, true);
  assert.equal(returnRejectRequestSchema.safeParse({ reason: 'fine reason', status: 'x' }).success, false);
});

test('a receive lists lines with a quantity and a restock choice, and nothing else', () => {
  assert.equal(returnReceiveRequestSchema.safeParse({ items: [{ ...item, restock: true }] }).success, true);
  const bad: Array<[unknown, string]> = [
    [{}, 'items'],
    [{ items: [] }, 'items'],
    [{ items: [item] }, 'items.0.restock'],
    [{ items: [{ ...item, restock: 'yes' }] }, 'items.0.restock'],
    [{ items: [{ ...item, quantity: 0, restock: true }] }, 'items.0.quantity'],
  ];
  for (const [value, field] of bad) assert.deepEqual(failingPaths(returnReceiveRequestSchema.safeParse(value)).slice(0, 1), [field], JSON.stringify(value));
  assert.equal(returnReceiveRequestSchema.safeParse({ items: [{ ...item, restock: true }], status: 'received' }).success, false);
});

test('a refund is whole rupees of at least 1, paid by bank, jazzcash, easypaisa or cash, with an optional plain reference', () => {
  assert.deepEqual(returnRefundRequestSchema.parse({ amount: 500, method: 'cash' }), { amount: 500, method: 'cash', reference: null });
  assert.equal(returnRefundRequestSchema.parse({ amount: 500, method: 'bank', reference: ' JC-778812 ' }).reference, 'JC-778812');
  assert.deepEqual([...REFUND_METHODS], ['bank', 'jazzcash', 'easypaisa', 'cash']);
  const bad: Array<[unknown, string]> = [
    [{ method: 'cash' }, 'amount'],
    [{ amount: 0, method: 'cash' }, 'amount'],
    [{ amount: -5, method: 'cash' }, 'amount'],
    [{ amount: 10.5, method: 'cash' }, 'amount'],
    [{ amount: '500', method: 'cash' }, 'amount'],
    [{ amount: 500 }, 'method'],
    [{ amount: 500, method: 'stripe' }, 'method'],
    [{ amount: 500, method: 'cash', reference: 'x'.repeat(101) }, 'reference'],
    [{ amount: 500, method: 'cash', reference: '<x>' }, 'reference'],
  ];
  for (const [value, field] of bad) assert.deepEqual(failingPaths(returnRefundRequestSchema.safeParse(value)).slice(0, 1), [field], JSON.stringify(value));
  assert.equal(returnRefundRequestSchema.safeParse({ amount: 500, method: 'cash', refundAmount: 1 }).success, false, 'the running total is not a field a seller can send');
});

test('the list query: a known status, a page and a limit with defaults and caps', () => {
  assert.deepEqual(returnListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.deepEqual(returnListQuerySchema.parse({ status: 'received', page: '2', limit: '50' }), { status: 'received', page: 2, limit: 50 });
  for (const [value, field] of [[{ status: 'maybe' }, 'status'], [{ page: '0' }, 'page'], [{ limit: '101' }, 'limit'], [{ limit: 'x' }, 'limit']] as const) {
    assert.deepEqual(failingPaths(returnListQuerySchema.safeParse(value)).slice(0, 1), [field], JSON.stringify(value));
  }
});

// ------------------------------------------------------------------------------------------------------------------ settings

test("the 'returns' settings group: returnWindowDays is a whole number from 0 to 30, strict, partial", () => {
  for (const days of [0, 7, 30]) assert.equal(storeReturnsUpdateSchema.safeParse({ returnWindowDays: days }).success, true, String(days));
  for (const days of [-1, 31, 7.5, '7', null]) assert.equal(storeReturnsUpdateSchema.safeParse({ returnWindowDays: days }).success, false, String(days));
  assert.equal(storeReturnsUpdateSchema.safeParse({}).success, true);
  assert.equal(storeReturnsUpdateSchema.safeParse({ returnWindowDays: 7, banana: 1 }).success, false);
  assert.equal(storeSettingsUpdateSchema.safeParse({ returns: { returnWindowDays: 14 } }).success, true);
  assert.deepEqual(failingPaths(storeSettingsUpdateSchema.safeParse({ returns: { returnWindowDays: 40 } })), ['returns.returnWindowDays']);
});

test('the batch adds its codes: the return_requested alert kind and RETURN_NOT_ELIGIBLE', () => {
  assert.ok((SELLER_ALERT_KINDS as readonly string[]).includes('return_requested'));
  assert.ok((STOREFRONT_ERROR_CODES as readonly string[]).includes('RETURN_NOT_ELIGIBLE'));
});
