import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_V1_ERROR_CODES,
  API_V1_LIMIT_DEFAULT,
  API_V1_LIMIT_MAX,
  API_V1_PRODUCT_STATUSES,
  API_V1_VERSION,
  apiV1CategorySchema,
  apiV1ErrorSchema,
  apiV1ImageSchema,
  apiV1OrderDetailSchema,
  apiV1OrderItemSchema,
  apiV1OrderListSchema,
  apiV1OrderSchema,
  apiV1ProductDetailSchema,
  apiV1ProductListSchema,
  apiV1ProductSchema,
} from '../src/api-v1';

// Sprint 8 (S8-B5, D-118): the v1 response shapes are FROZEN. Third parties read these names: renaming, removing or adding one must fail here. A breaking
// change is a v2, not an edit of this list.

const names = (schema: unknown): string[] => Object.keys((schema as { shape: Record<string, unknown> }).shape);

test('the version and the paging bounds', () => {
  assert.equal(API_V1_VERSION, 'v1');
  assert.equal(API_V1_LIMIT_DEFAULT, 20);
  assert.equal(API_V1_LIMIT_MAX, 100);
});

test('the exact field names of every v1 shape', () => {
  assert.deepEqual(names(apiV1ProductSchema), ['id', 'name', 'slug', 'description', 'price', 'comparePrice', 'stock', 'status', 'category', 'images', 'updatedAt']);
  assert.deepEqual(names(apiV1CategorySchema), ['id', 'name', 'slug']);
  assert.deepEqual(names(apiV1ImageSchema), ['url', 'alt']);
  assert.deepEqual(names(apiV1OrderSchema), ['id', 'orderId', 'status', 'paymentMethod', 'paymentStatus', 'items', 'subtotal', 'deliveryCharges', 'discount', 'taxAmount', 'total', 'city', 'createdAt', 'updatedAt']);
  assert.deepEqual(names(apiV1OrderItemSchema), ['productId', 'variantId', 'name', 'variantName', 'sku', 'unitPrice', 'quantity']);
  for (const list of [apiV1ProductListSchema, apiV1OrderListSchema]) assert.deepEqual(names(list), ['data', 'nextCursor']);
  for (const detail of [apiV1ProductDetailSchema, apiV1OrderDetailSchema]) assert.deepEqual(names(detail), ['data']);
  assert.deepEqual([...API_V1_PRODUCT_STATUSES], ['published', 'draft', 'taken_down']);
  assert.deepEqual([...API_V1_ERROR_CODES], ['UNAUTHORIZED', 'FORBIDDEN_SCOPE', 'STORE_UNAVAILABLE', 'PLAN_LIMIT_REACHED', 'INVALID_REQUEST', 'NOT_FOUND', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE']);
});

const order = {
  id: 'a', orderId: 'MKZ-1', status: 'pending', paymentMethod: 'cod', paymentStatus: 'unpaid',
  items: [{ productId: 'p', variantId: 'v', name: 'Shirt', variantName: 'Default', sku: null, unitPrice: 500, quantity: 2 }],
  subtotal: 1000, deliveryCharges: 200, discount: 0, taxAmount: 0, total: 1200, city: 'Lahore', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
};

test('every object is strict: a customer name, phone, email or address can never be part of an order', () => {
  assert.equal(apiV1OrderSchema.safeParse(order).success, true);
  for (const field of ['customerName', 'phone', 'customerEmail', 'address', 'customerWhatsapp', 'customerNote', 'notes']) {
    assert.equal(apiV1OrderSchema.safeParse({ ...order, [field]: 'x' }).success, false, field);
  }
});

test('money is whole rupees and dates are ISO', () => {
  assert.equal(apiV1OrderSchema.safeParse({ ...order, total: 10.5 }).success, false);
  assert.equal(apiV1OrderSchema.safeParse({ ...order, createdAt: '1 November' }).success, false);
});

test('an error is { error: { code, message } }, with field or retryAfterSeconds where they apply', () => {
  assert.equal(apiV1ErrorSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'Not found.' } }).success, true);
  assert.equal(apiV1ErrorSchema.safeParse({ error: { code: 'INVALID_REQUEST', message: 'x', field: 'limit' } }).success, true);
  assert.equal(apiV1ErrorSchema.safeParse({ errors: [{ message: 'x' }] }).success, false);
});
