
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_ORDER_PAYMENT_STATUSES,
  DASHBOARD_ORDER_STATUSES,
  dashboardOrderDetailSchema,
  dashboardOrderListItemSchema,
  dashboardOrderListQuerySchema,
  ORDER_LIST_DEFAULT_LIMIT,
  ORDER_LIST_MAX_LIMIT,
  ORDER_PAYMENT_STATUS_LABELS,
  ORDER_SEARCH_MAX_LENGTH,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_NOTE_MAX,
  orderSchema,
  orderTransitionRequestSchema,
  orderCancelRequestSchema,
  orderCancelResponseSchema,
  ORDER_CANCEL_REASON_OPTIONS,
  COURIERS,
  COURIER_NAME_MAX,
  TRACKING_NUMBER_MAX,
  orderTrackingRequestSchema,
  orderPaymentRequestSchema,
  orderNoteRequestSchema,
  ORDER_NOTE_TEXT_MAX,
  labelCodAmount,
  orderPrintResponseSchema,
} from '../src/order';
import { storefrontOrderTrackingResponseSchema, storefrontOrderTrackingSchema } from '../src/storefront';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: '65a000000000000000000005',
    orderGroupId: 'grp-1',
    store: '65a000000000000000000001',
    orderId: 'ORD-1',
    idempotencyKey: 'idem-1',
    status: 'pending',
    paymentMethod: 'cod',
    customerName: 'Sara',
    phone: '03001234567',
    city: 'Karachi',
    address: 'Block 5',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 2 }],
    subtotal: 2400,
    deliveryCharges: 200,
    total: 2600,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('an order parses', () => {
  assert.equal(orderSchema.safeParse(order()).success, true);
});

test('a missing total is reported against total', () => {
  const { total: _omit, ...rest } = order();
  assert.deepEqual(failingPaths(orderSchema.safeParse(rest)), ['total']);
});

test('a zero quantity is reported against the line quantity', () => {
  const bad = order({ items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Shirt', variantTitle: 'Default', unitPrice: 1200, quantity: 0 }] });
  assert.deepEqual(failingPaths(orderSchema.safeParse(bad)), ['items.0.quantity']);
});

test('the wire identity is id, not _id', () => {
  assert.deepEqual(failingPaths(orderSchema.safeParse(order({ id: 'nope' }))), ['id']);
});

// EP-02 OB-1b: dashboard order schemas.

test('dashboard list query: defaults, limit cap and q cut', () => {
  const parsed = dashboardOrderListQuerySchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, ORDER_LIST_DEFAULT_LIMIT);
  assert.equal(dashboardOrderListQuerySchema.parse({ limit: '500' }).limit, ORDER_LIST_MAX_LIMIT);
  assert.equal(dashboardOrderListQuerySchema.parse({ q: '  ' + 'a'.repeat(60) + '  ' }).q, 'a'.repeat(ORDER_SEARCH_MAX_LENGTH));
  assert.equal(dashboardOrderListQuerySchema.parse({ q: '  Sara  ' }).q, 'Sara');
});

test('dashboard list query: bad values are reported against their field', () => {
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ status: 'shipped' })), ['status']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ from: '2026-13-01' })), ['from']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ to: '2026-02-30' })), ['to']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ from: '7/11/2026' })), ['from']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ from: '2026-11-08', to: '2026-11-07' })), ['to']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ page: '0' })), ['page']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ limit: 'abc' })), ['limit']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ limit: '1.5' })), ['limit']);
  assert.equal(dashboardOrderListQuerySchema.safeParse({ from: '2026-11-07', to: '2026-11-07', status: 'returned' }).success, true);
});

test('dashboard statuses match the storefront set, and every status and payment status has a label', () => {
  assert.deepEqual([...DASHBOARD_ORDER_STATUSES], ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned']);
  for (const status of DASHBOARD_ORDER_STATUSES) assert.ok(ORDER_STATUS_LABELS[status], status);
  assert.equal(ORDER_STATUS_LABELS.processing, 'Processing');
  for (const status of DASHBOARD_ORDER_PAYMENT_STATUSES) assert.ok(ORDER_PAYMENT_STATUS_LABELS[status], status);
});

test('dashboard list item and detail parse, and unknown keys are stripped', () => {
  const NOW_ISO = '2026-11-07T10:00:00.000Z';
  const item = {
    id: '65a000000000000000000005', orderId: 'ORD-1', status: 'pending', paymentMethod: 'cod', paymentStatus: 'unpaid',
    customerName: 'Sara', phone: '+923001234567', city: null, total: 2600, itemCount: 2, courier: null, trackingNumber: null,
    createdAt: NOW_ISO, idempotencyKey: 'idem-12345678',
  };
  const parsedItem = dashboardOrderListItemSchema.parse(item);
  assert.equal('idempotencyKey' in parsedItem, false);
  const detail = {
    id: item.id, orderId: 'ORD-1', status: 'confirmed', paymentMethod: null, paymentStatus: 'unpaid', collectedAt: null,
    collectedAmount: null, customerName: null, phone: null, address: null, city: null,
    items: [{ productTitle: 'Shirt', variantTitle: 'Default', sku: null, unitPrice: 1200, quantity: 2, lineTotal: 2400, stockDeducted: true }],
    paidAt: null, stripeSessionId: null, subtotal: 2400, deliveryCharges: 200, discountCode: null, discountAmount: 0, total: 2600, courier: null, trackingNumber: null, trackingUrl: null,
    statusHistory: [{ from: 'pending', to: 'confirmed', by: null, at: NOW_ISO, note: null }],
    notes: [{ id: null, text: 'Call first', by: null, at: NOW_ISO }],
    cancelledAt: null, cancelReason: null, createdAt: NOW_ISO, updatedAt: NOW_ISO, allowedNext: ['processing'], canCancel: true, canEditTracking: false, canMarkCollected: false,
    timeline: [{ id: 'placed', kind: 'placed', at: NOW_ISO, title: 'Order placed', detail: null }],
  };
  assert.equal(dashboardOrderDetailSchema.safeParse(detail).success, true);
  assert.deepEqual(failingPaths(dashboardOrderDetailSchema.safeParse({ ...detail, paymentStatus: 'refunded' })), ['paymentStatus']);
});

// EP-02 OB-2: the transition request.

test('transition request: a status and an optional trimmed note', () => {
  const parsed = orderTransitionRequestSchema.parse({ status: 'confirmed', note: '  Called the customer  ' });
  assert.equal(parsed.status, 'confirmed');
  assert.equal(parsed.note, 'Called the customer');
  assert.equal(orderTransitionRequestSchema.safeParse({ status: 'confirmed' }).success, true);
  assert.equal(orderTransitionRequestSchema.safeParse({ status: 'confirmed', note: 'x'.repeat(ORDER_STATUS_NOTE_MAX) }).success, true);
});

test('transition request: bad values are reported against their field', () => {
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({})), ['status']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ status: 'shipped' })), ['status']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ status: 'confirmed', note: 'x'.repeat(ORDER_STATUS_NOTE_MAX + 1) })), ['note']);
  // OB-4: a dispatch must name courier and tracking number, so each case sends the other required field.
  const dispatch = { status: 'dispatched', courier: 'TCS', trackingNumber: '123' };
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...dispatch, courier: 'x'.repeat(61) })), ['courier']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...dispatch, trackingNumber: 'x'.repeat(65) })), ['trackingNumber']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...dispatch, trackingUrl: 'ftp://x.test/1' })), ['trackingUrl']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...dispatch, trackingUrl: 'javascript:alert(1)' })), ['trackingUrl']);
});

test('transition request: courier and tracking are accepted only with dispatched, and required for it (OB-4)', () => {
  const dispatch = orderTransitionRequestSchema.parse({
    status: 'dispatched', courier: ' TCS ', trackingNumber: ' 123 ', trackingUrl: 'https://tcs.test/track/123',
  });
  assert.equal(dispatch.courier, 'TCS');
  assert.equal(dispatch.trackingNumber, '123');
  // OB-4 (D-064): a dispatch without courier or tracking number is refused on that field.
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ status: 'dispatched' })), ['courier', 'trackingNumber']);
  for (const field of ['courier', 'trackingNumber', 'trackingUrl']) {
    const value = field === 'trackingUrl' ? 'https://tcs.test/1' : 'TCS';
    assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ status: 'confirmed', [field]: value })), [field], field);
  }
});

test('transition request: unknown keys are dropped', () => {
  const parsed = orderTransitionRequestSchema.parse({ status: 'confirmed', store: 'x', total: 1, statusHistory: [] });
  assert.deepEqual(Object.keys(parsed), ['status']);
});

// EP-02 OB-3: the cancel request.

test('cancel request: a trimmed reason of 3 to 200 characters and an optional note', () => {
  const parsed = orderCancelRequestSchema.parse({ reason: '  Customer asked to cancel  ', note: '  called twice  ' });
  assert.equal(parsed.reason, 'Customer asked to cancel');
  assert.equal(parsed.note, 'called twice');
  assert.equal(orderCancelRequestSchema.safeParse({ reason: 'abc' }).success, true);
  assert.equal(orderCancelRequestSchema.safeParse({ reason: 'x'.repeat(200) }).success, true);
  for (const option of ORDER_CANCEL_REASON_OPTIONS) assert.equal(orderCancelRequestSchema.safeParse({ reason: option }).success, true, option);
});

test('cancel request: a missing, short or long reason and a long note are reported against their field', () => {
  assert.deepEqual(failingPaths(orderCancelRequestSchema.safeParse({})), ['reason']);
  assert.deepEqual(failingPaths(orderCancelRequestSchema.safeParse({ reason: '  ab  ' })), ['reason']);
  assert.deepEqual(failingPaths(orderCancelRequestSchema.safeParse({ reason: 'x'.repeat(201) })), ['reason']);
  assert.deepEqual(failingPaths(orderCancelRequestSchema.safeParse({ reason: 'Out of stock', note: 'x'.repeat(501) })), ['note']);
  assert.deepEqual(failingPaths(orderCancelRequestSchema.safeParse({ reason: 12345 })), ['reason']);
});

test('cancel request: unknown keys are dropped; the response pairs the detail with the stock result', () => {
  assert.deepEqual(Object.keys(orderCancelRequestSchema.parse({ reason: 'Out of stock', status: 'cancelled', store: 'x' })), ['reason']);
  const stockRestore = {
    restored: [{ name: 'T-Shirt (M)', sku: 'TS-M', qty: 2 }],
    skipped: [{ name: 'Cap', why: 'product_deleted' }],
    failed: [{ name: 'Mug' }],
  };
  assert.deepEqual(failingPaths(orderCancelResponseSchema.safeParse({ order: {}, stockRestore })).includes('order.id'), true);
  assert.deepEqual(failingPaths(orderCancelResponseSchema.safeParse({ order: {}, stockRestore: { ...stockRestore, skipped: [{ name: 'x', why: 'gone' }] } })).includes('stockRestore.skipped.0.why'), true);
});

// EP-02 OB-4: couriers, dispatch rules, the tracking edit and customer tracking.

test('couriers: the suggested list, and any trimmed name of 2 to 40 characters is accepted', () => {
  assert.deepEqual([...COURIERS], ['TCS', 'Leopards', 'M&P', 'Trax', 'PostEx', 'BlueEx', 'Call Courier', 'Pakistan Post', 'Other']);
  const base = { status: 'dispatched', trackingNumber: 'T1' };
  for (const courier of COURIERS) assert.equal(orderTransitionRequestSchema.safeParse({ ...base, courier }).success, true, courier);
  assert.equal(orderTransitionRequestSchema.parse({ ...base, courier: '  Swift Riders  ' }).courier, 'Swift Riders');
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...base, courier: ' X ' })), ['courier']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...base, courier: 'x'.repeat(COURIER_NAME_MAX + 1) })), ['courier']);
  assert.equal(orderTransitionRequestSchema.safeParse({ ...base, courier: 'x'.repeat(COURIER_NAME_MAX) }).success, true);
});

test('dispatch: tracking number 1 to 60 characters; a missing courier or tracking number names its field', () => {
  const base = { status: 'dispatched', courier: 'TCS' };
  assert.equal(orderTransitionRequestSchema.safeParse({ ...base, trackingNumber: 'x'.repeat(TRACKING_NUMBER_MAX) }).success, true);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...base, trackingNumber: 'x'.repeat(TRACKING_NUMBER_MAX + 1) })), ['trackingNumber']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ ...base, trackingNumber: '   ' })), ['trackingNumber']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse(base)), ['trackingNumber']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ status: 'dispatched', trackingNumber: '1' })), ['courier']);
});

test('tracking edit request: at least one field, the same rules, and null clears the link', () => {
  assert.equal(orderTrackingRequestSchema.parse({ trackingNumber: ' 99 ' }).trackingNumber, '99');
  assert.equal(orderTrackingRequestSchema.parse({ trackingUrl: null }).trackingUrl, null);
  assert.equal(orderTrackingRequestSchema.safeParse({}).success, false);
  assert.equal(orderTrackingRequestSchema.safeParse({ store: 'x' }).success, false, 'unknown keys alone are not a change');
  assert.deepEqual(failingPaths(orderTrackingRequestSchema.safeParse({ courier: 'x' })), ['courier']);
  assert.deepEqual(failingPaths(orderTrackingRequestSchema.safeParse({ trackingUrl: 'javascript:alert(1)' })), ['trackingUrl']);
  assert.deepEqual(Object.keys(orderTrackingRequestSchema.parse({ courier: 'TCS', status: 'delivered' })), ['courier']);
});

test('customer tracking: the response holds exactly the allowed keys, and an extra key fails', () => {
  const data = {
    orderId: 'ORD-ABCD2345',
    status: 'dispatched',
    createdAt: '2026-11-01T10:00:00.000Z',
    dates: { pending: '2026-11-01T10:00:00.000Z', confirmed: null, processing: null, dispatched: '2026-11-03T10:00:00.000Z', delivered: null, cancelled: null, returned: null },
    courier: 'TCS',
    trackingNumber: '123',
    trackingUrl: null,
  };
  assert.equal(storefrontOrderTrackingResponseSchema.safeParse({ data }).success, true);
  assert.deepEqual(Object.keys(storefrontOrderTrackingSchema.shape).sort(), ['courier', 'createdAt', 'dates', 'orderId', 'status', 'trackingNumber', 'trackingUrl']);
  for (const extra of ['customerName', 'phone', 'address', 'city', 'items', 'total', 'notes', 'cancelReason', 'paymentStatus', 'id', 'idempotencyKey']) {
    assert.equal(storefrontOrderTrackingSchema.safeParse({ ...data, [extra]: 'x' }).success, false, extra);
  }
  assert.equal(storefrontOrderTrackingSchema.safeParse({ ...data, dates: { ...data.dates, shipped: null } }).success, false);
  assert.equal(storefrontOrderTrackingResponseSchema.safeParse({ data, extra: 1 }).success, false);
});

// EP-02 OB-5a: payment and note requests.

test('payment request: amount is optional, positive, with at most two decimals', () => {
  assert.deepEqual(orderPaymentRequestSchema.parse({}), {});
  assert.equal(orderPaymentRequestSchema.parse({ amount: 4500 }).amount, 4500);
  assert.equal(orderPaymentRequestSchema.parse({ amount: 19.99 }).amount, 19.99);
  for (const amount of [0, -1, 1.234, '4500', null]) {
    assert.deepEqual(failingPaths(orderPaymentRequestSchema.safeParse({ amount })), ['amount'], String(amount));
  }
  assert.deepEqual(Object.keys(orderPaymentRequestSchema.parse({ amount: 1, paymentStatus: 'collected' })), ['amount']);
});

test('note request: text is trimmed, 1 to 500 characters; unknown keys are dropped', () => {
  assert.equal(orderNoteRequestSchema.parse({ text: '  Call first  ' }).text, 'Call first');
  assert.equal(orderNoteRequestSchema.safeParse({ text: 'x'.repeat(ORDER_NOTE_TEXT_MAX) }).success, true);
  for (const text of ['', '   ', 'x'.repeat(ORDER_NOTE_TEXT_MAX + 1), 5]) {
    assert.deepEqual(failingPaths(orderNoteRequestSchema.safeParse({ text })), ['text']);
  }
  assert.deepEqual(failingPaths(orderNoteRequestSchema.safeParse({})), ['text']);
  assert.deepEqual(Object.keys(orderNoteRequestSchema.parse({ text: 'a', by: 'x', at: 'y' })), ['text']);
});

// EP-02 OB-5b: print data.

test('labelCodAmount: the total for unpaid COD, 0 for collected COD, any other method or a missing one', () => {
  assert.equal(labelCodAmount({ paymentMethod: 'cod', paymentStatus: 'unpaid', total: 4500 }), 4500);
  assert.equal(labelCodAmount({ paymentMethod: 'cod', total: 4500 }), 4500, 'a missing paymentStatus is unpaid');
  assert.equal(labelCodAmount({ paymentMethod: 'cod', paymentStatus: 'collected', total: 4500 }), 0);
  assert.equal(labelCodAmount({ paymentMethod: 'card', paymentStatus: 'unpaid', total: 4500 }), 0);
  assert.equal(labelCodAmount({ paymentStatus: 'unpaid', total: 4500 }), 0);
  assert.equal(labelCodAmount({ paymentMethod: null, total: 4500 }), 0);
});

test('labelCodAmount: rounds to 2 decimals and never returns a bad number', () => {
  assert.equal(labelCodAmount({ paymentMethod: 'cod', total: 1.005 }), 1.01);
  assert.equal(labelCodAmount({ paymentMethod: 'cod', total: 19.999 }), 20);
  assert.equal(labelCodAmount({ paymentMethod: 'cod', total: 0.1 + 0.2 }), 0.3);
  for (const total of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined, '100']) {
    assert.equal(labelCodAmount({ paymentMethod: 'cod', total }), 0, String(total));
  }
});

test('print response: parses a full response and rejects an extra key at every level', () => {
  const item = { title: 'Shirt', variantTitle: null, sku: null, qty: 2 };
  const sheet = {
    id: '65a000000000000000000005', orderId: 'ORD-1', createdAt: '2026-11-01T10:00:00.000Z', status: 'dispatched',
    customerName: 'Sara', phone: '+923001234567', address: 'House 1', city: null, items: [item],
    paymentMethod: 'cod', paymentStatus: 'unpaid', codAmount: 2400, courier: null, trackingNumber: null,
  };
  const body = { store: { name: 'Shop' }, orders: [sheet], skipped: [{ id: 'x', reason: 'cancelled' }] };
  assert.equal(orderPrintResponseSchema.safeParse(body).success, true);
  assert.equal(orderPrintResponseSchema.safeParse({ ...body, extra: 1 }).success, false);
  assert.equal(orderPrintResponseSchema.safeParse({ ...body, store: { name: 'Shop', owner: 'x' } }).success, false);
  for (const extra of ['notes', 'statusHistory', 'timeline', 'idempotencyKey', 'store']) {
    assert.equal(orderPrintResponseSchema.safeParse({ ...body, orders: [{ ...sheet, [extra]: [] }] }).success, false, extra);
  }
  assert.equal(orderPrintResponseSchema.safeParse({ ...body, orders: [{ ...sheet, items: [{ ...item, unitPrice: 1 }] }] }).success, false);
  assert.equal(orderPrintResponseSchema.safeParse({ ...body, skipped: [{ id: 'x', reason: 'gone' }] }).success, false);
});

// EP-02 OB-6: a stored status outside the seven.

test('dashboard shapes accept unknown as a status to show, but a request or filter never does', () => {
  const item = {
    id: '65a000000000000000000005', orderId: 'ORD-1', status: 'unknown', paymentMethod: 'cod', paymentStatus: 'unpaid',
    customerName: null, phone: null, city: null, total: 1, itemCount: 1, courier: null, trackingNumber: null, createdAt: '2026-11-01T10:00:00.000Z',
  };
  assert.equal(dashboardOrderListItemSchema.safeParse(item).success, true);
  assert.deepEqual(failingPaths(dashboardOrderListItemSchema.safeParse({ ...item, status: 'shipped' })), ['status']);
  assert.deepEqual(failingPaths(dashboardOrderListQuerySchema.safeParse({ status: 'unknown' })), ['status']);
  assert.deepEqual(failingPaths(orderTransitionRequestSchema.safeParse({ status: 'unknown' })), ['status']);
});
