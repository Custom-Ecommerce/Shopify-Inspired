import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STOREFRONT_ERROR_CODES,
  STOREFRONT_IDEMPOTENCY_KEY_PATTERN,
  STOREFRONT_PRODUCT_SLUG_PATTERN,
  storefrontCreateOrderRequestSchema,
  storefrontOrderCreatedResponseSchema,
  storefrontOrderLookupRequestSchema,
  storefrontOrderLookupResponseSchema,
  storefrontProductDetailResponseSchema,
  storefrontProductDetailSchema,
} from '../src';

const detail = {
  id: 'p1',
  slug: 'blue-shirt',
  title: 'Blue shirt',
  currency: 'PKR' as const,
  price: 1500,
  originalPrice: 1800,
  stockStatus: 'in_stock' as const,
  primaryImage: { url: 'https://res.cloudinary.com/x/a.jpg', alt: 'Blue shirt' },
  categories: [{ id: 'c1', slug: 'shirts', name: 'Shirts' }],
  avgRating: 4.5,
  reviewCount: 12,
  description: 'A shirt.',
  highlights: ['Cotton'],
  images: [{ url: 'https://res.cloudinary.com/x/a.jpg', alt: 'Blue shirt' }],
  seo: { title: null, description: null, imageUrl: null },
  tags: ['summer'],
  categorySlugs: ['shirts'],
  deliveryCharge: 200,
};

test('product detail accepts the storefront shape and rejects a missing delivery charge', () => {
  assert.equal(storefrontProductDetailSchema.safeParse(detail).success, true);
  assert.equal(storefrontProductDetailResponseSchema.safeParse({ data: detail }).success, true);
  const { deliveryCharge: _omit, ...rest } = detail;
  assert.equal(storefrontProductDetailSchema.safeParse(rest).success, false);
});

test('product slug pattern is one path segment', () => {
  assert.equal(STOREFRONT_PRODUCT_SLUG_PATTERN.test('blue-shirt'), true);
  assert.equal(STOREFRONT_PRODUCT_SLUG_PATTERN.test('a/b'), false);
  assert.equal(STOREFRONT_PRODUCT_SLUG_PATTERN.test('a b'), false);
  assert.equal(STOREFRONT_PRODUCT_SLUG_PATTERN.test(''), false);
});

const request = {
  customer: { customerName: 'Sara Khan', phone: '0300 1234567', address: 'House 12, Street 4, Block 5' },
  lines: [{ productId: '65a0000000000000000000b1', qty: 2 }],
};

test('create-order request accepts what the storefront transport sends', () => {
  assert.equal(storefrontCreateOrderRequestSchema.safeParse(request).success, true);
});

test('create-order request strips prices and totals: the client cannot set them', () => {
  const parsed = storefrontCreateOrderRequestSchema.parse({
    ...request,
    total: 1,
    subtotal: 1,
    lines: [{ productId: '65a0000000000000000000b1', qty: 2, price: 1, unitPrice: 1 }],
  });
  assert.equal('total' in parsed, false);
  assert.equal('subtotal' in parsed, false);
  assert.deepEqual(parsed.lines[0], { productId: '65a0000000000000000000b1', qty: 2 });
});

test('create-order request rejects a short address, a short name, and a bad payment method', () => {
  assert.equal(storefrontCreateOrderRequestSchema.safeParse({ ...request, customer: { ...request.customer, address: 'short' } }).success, false);
  assert.equal(storefrontCreateOrderRequestSchema.safeParse({ ...request, customer: { ...request.customer, customerName: 'A' } }).success, false);
  assert.equal(storefrontCreateOrderRequestSchema.safeParse({ ...request, paymentMethod: 'bitcoin' }).success, false);
  assert.equal(storefrontCreateOrderRequestSchema.safeParse({ ...request, paymentMethod: 'cod' }).success, true);
});

test('create-order request caps the number of lines', () => {
  const lines = Array.from({ length: 51 }, () => ({ productId: '65a0000000000000000000b1', qty: 1 }));
  assert.equal(storefrontCreateOrderRequestSchema.safeParse({ ...request, lines }).success, false);
});

test('idempotency key pattern accepts UUIDs and the client fallback, rejects short or spaced keys', () => {
  assert.equal(STOREFRONT_IDEMPOTENCY_KEY_PATTERN.test('3b241101-e2bb-4255-8caf-4136c566a962'), true);
  assert.equal(STOREFRONT_IDEMPOTENCY_KEY_PATTERN.test('idem-lq3x9a-k2j4h8s1'), true);
  assert.equal(STOREFRONT_IDEMPOTENCY_KEY_PATTERN.test('short'), false);
  assert.equal(STOREFRONT_IDEMPOTENCY_KEY_PATTERN.test('has space in it'), false);
});

const created = {
  orderId: 'ORD-7KQ4M2XA',
  status: 'pending' as const,
  paymentMethod: 'cod' as const,
  subtotal: 3000,
  deliveryCharges: 200,
  total: 3200,
  createdAt: '2026-10-14T10:00:00.000Z',
};

test('created-order response is a superset of the provisional wire shape { orderId, total }', () => {
  const parsed = storefrontOrderCreatedResponseSchema.safeParse({ data: created });
  assert.equal(parsed.success, true);
  assert.equal(storefrontOrderCreatedResponseSchema.safeParse({ data: { orderId: 'ORD-1', total: 1 } }).success, false);
});

test('lookup request and response shapes', () => {
  assert.equal(storefrontOrderLookupRequestSchema.safeParse({ orderId: 'ORD-7KQ4M2XA', phone: '03001234567' }).success, true);
  assert.equal(storefrontOrderLookupRequestSchema.safeParse({ orderId: '', phone: '03001234567' }).success, false);

  const order = {
    ...created,
    customerName: 'Sara Khan',
    phone: '+923001234567',
    city: null,
    address: 'House 12, Street 4, Block 5',
    items: [{ productId: 'p1', title: 'Blue shirt', unitPrice: 1500, qty: 2, lineTotal: 3000 }],
    updatedAt: '2026-10-14T10:00:00.000Z',
  };
  assert.equal(storefrontOrderLookupResponseSchema.safeParse({ data: order }).success, true);
  assert.equal(
    storefrontOrderLookupResponseSchema.safeParse({ data: { ...order, items: [{ ...order.items[0], qty: 0 }] } }).success,
    false,
  );
});

test('the error code list carries the Part 7 codes', () => {
  for (const code of ['ORDER_NOT_FOUND', 'EMPTY_ORDER', 'INVALID_QUANTITY', 'UNKNOWN_PRODUCT', 'OUT_OF_STOCK', 'IDEMPOTENCY_CONFLICT', 'RATE_LIMITED']) {
    assert.ok((STOREFRONT_ERROR_CODES as readonly string[]).includes(code), code);
  }
});
