import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOREFRONT_EVENTS, dailyStatSchema, storefrontBrowserEventSchema, storefrontEventRequestSchema } from '../src/storefront-events';

// Sprint 8 (S8-B6, D-118): the strict shapes of the anonymous counters.

const store = '65a000000000000000000011';

test('four events', () => {
  assert.deepEqual([...STOREFRONT_EVENTS], ['page_view', 'product_view', 'add_to_cart', 'checkout_start']);
});

test('a product view names a product, nothing else does, and no other key is accepted (no id, no IP)', () => {
  for (const event of ['page_view', 'add_to_cart', 'checkout_start']) {
    assert.equal(storefrontEventRequestSchema.safeParse({ store, event }).success, true, event);
    assert.equal(storefrontEventRequestSchema.safeParse({ store, event, productSlug: 'a' }).success, false, event);
    assert.equal(storefrontBrowserEventSchema.safeParse({ event }).success, true, event);
  }
  assert.equal(storefrontEventRequestSchema.safeParse({ store, event: 'product_view', productSlug: 'a' }).success, true);
  assert.equal(storefrontEventRequestSchema.safeParse({ store, event: 'product_view' }).success, false);
  for (const extra of [{ ip: '1.2.3.4' }, { visitorId: 'x' }, { userAgent: 'x' }]) {
    assert.equal(storefrontEventRequestSchema.safeParse({ store, event: 'page_view', ...extra }).success, false, JSON.stringify(extra));
  }
  assert.equal(storefrontBrowserEventSchema.safeParse({ store, event: 'page_view' }).success, false, 'the browser never names the store');
});

test('a day of counters is a strict object of whole numbers', () => {
  const day = { day: '2026-11-25', visits: 1, productViews: 0, addToCart: 0, checkoutStarts: 0, orders: 2 };
  assert.equal(dailyStatSchema.safeParse(day).success, true);
  assert.equal(dailyStatSchema.safeParse({ ...day, ip: 'x' }).success, false);
  assert.equal(dailyStatSchema.safeParse({ ...day, visits: 1.5 }).success, false);
});
