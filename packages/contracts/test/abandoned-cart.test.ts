import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABANDONED_CART_CONSENT_LINE,
  ABANDONED_CART_EMAIL_DELAY_MS,
  ABANDONED_CART_ITEMS_MAX,
  ABANDONED_CART_STATUSES,
  ABANDONED_CART_TTL_DAYS,
  abandonedCartContactedRequestSchema,
  abandonedCartListQuerySchema,
  abandonedCartRequestSchema,
} from '../src/abandoned-cart';
import { failingPaths } from './helpers';

// Sprint 5 EP-28 (D-107): the abandoned cart contract: nothing without a valid phone and the consent, only ids and quantities from the browser, the
// seller's list filters, the one move a seller makes.

const PRODUCT = '65a0000000000000000c0001';
const body = { phone: '0300 1234567', consent: true, lines: [{ productId: PRODUCT, variantId: '65a0000000000000000d0001', qty: 2 }] };
const failing = (fields: Record<string, unknown>): string[] => failingPaths(abandonedCartRequestSchema.safeParse({ ...body, ...fields }));

test('the numbers: 7 days, 2 hours, at most 50 lines, the four statuses, and the consent line the checkout shows', () => {
  assert.equal(ABANDONED_CART_TTL_DAYS, 7);
  assert.equal(ABANDONED_CART_EMAIL_DELAY_MS, 2 * 60 * 60 * 1000);
  assert.equal(ABANDONED_CART_ITEMS_MAX, 50);
  assert.deepEqual([...ABANDONED_CART_STATUSES], ['open', 'contacted', 'recovered', 'expired']);
  assert.equal(ABANDONED_CART_CONSENT_LINE, 'We may message you about this cart');
});

test('a valid phone and the consent: the phone comes out as +923xxxxxxxxx, the email is optional and lower case', () => {
  const parsed = abandonedCartRequestSchema.parse(body);
  assert.equal(parsed.phone, '+923001234567');
  assert.equal(parsed.email, null);
  assert.equal(abandonedCartRequestSchema.parse({ ...body, email: ' Ayesha@Example.PK ' }).email, 'ayesha@example.pk');
  assert.equal(abandonedCartRequestSchema.parse({ ...body, email: '' }).email, null);
  assert.equal(abandonedCartRequestSchema.safeParse({ ...body, email: 'not an email' }).success, false);
});

test('nothing without a valid phone AND the consent (literally true), and not an empty cart', () => {
  assert.deepEqual(failing({ phone: '12345' }), ['phone']);
  assert.deepEqual(failing({ phone: '' }), ['phone']);
  const noPhone: Record<string, unknown> = { ...body };
  delete noPhone.phone;
  assert.deepEqual(failingPaths(abandonedCartRequestSchema.safeParse(noPhone)), ['phone']);
  for (const consent of [false, 'true', 1, null]) assert.deepEqual(failing({ consent }), ['consent'], String(consent));
  const noConsent: Record<string, unknown> = { ...body };
  delete noConsent.consent;
  assert.deepEqual(failingPaths(abandonedCartRequestSchema.safeParse(noConsent)), ['consent']);
  assert.deepEqual(failing({ lines: [] }), ['lines']);
  assert.deepEqual(failing({ lines: Array.from({ length: 51 }, () => body.lines[0]) }), ['lines']);
});

test('the browser sends ids and quantities only: a price or a total in the body is dropped, never kept', () => {
  const parsed = abandonedCartRequestSchema.parse({ ...body, total: 1, subtotal: 1, lines: [{ ...body.lines[0], unitPrice: 1, price: 1, total: 1, title: 'Free' }] });
  assert.equal('total' in parsed, false);
  assert.deepEqual(Object.keys(parsed.lines[0]!).sort(), ['productId', 'qty', 'variantId']);
});

test('the seller\'s list: status open, contacted or recovered, a page, at most 50 a page; anything else is refused', () => {
  assert.deepEqual(abandonedCartListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.deepEqual(abandonedCartListQuerySchema.parse({ status: 'contacted', page: '2', limit: '50' }), { status: 'contacted', page: 2, limit: 50 });
  for (const query of [{ status: 'expired' }, { status: 'nope' }, { limit: '51' }, { page: '0' }, { phone: '0300' }]) {
    assert.equal(abandonedCartListQuerySchema.safeParse(query).success, false, JSON.stringify(query));
  }
});

test('the one move a seller makes is open to contacted; any other status or field is refused', () => {
  assert.equal(abandonedCartContactedRequestSchema.safeParse({ status: 'contacted' }).success, true);
  for (const input of [{ status: 'recovered' }, { status: 'open' }, {}, { status: 'contacted', phone: '0300' }]) {
    assert.equal(abandonedCartContactedRequestSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});
