
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
  orderSchema,
} from '../src/order';
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
    items: [{ productTitle: 'Shirt', variantTitle: 'Default', sku: null, unitPrice: 1200, quantity: 2, lineTotal: 2400 }],
    subtotal: 2400, deliveryCharges: 200, total: 2600, courier: null, trackingNumber: null, trackingUrl: null,
    statusHistory: [{ from: 'pending', to: 'confirmed', by: null, at: NOW_ISO, note: null }],
    notes: [{ id: null, text: 'Call first', by: null, at: NOW_ISO }],
    cancelledAt: null, cancelReason: null, createdAt: NOW_ISO, updatedAt: NOW_ISO,
  };
  assert.equal(dashboardOrderDetailSchema.safeParse(detail).success, true);
  assert.deepEqual(failingPaths(dashboardOrderDetailSchema.safeParse({ ...detail, paymentStatus: 'paid' })), ['paymentStatus']);
});
