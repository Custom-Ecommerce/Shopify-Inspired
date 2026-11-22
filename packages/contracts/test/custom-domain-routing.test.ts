import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeSettingsUpdateSchema, storeSettingsSchema, storeReadinessSchema, STORE_READINESS_ITEMS, storeDomainUpdateSchema } from '../src/store-settings';
import { storefrontStoreSchema } from '../src/storefront';
import { failingPaths } from './helpers';

// S7-B6: the settings group "domain", the optional readiness step, and the public store record's domain fields.

test('the domain settings group takes only an exact boolean and nothing else', () => {
  assert.equal(storeDomainUpdateSchema.safeParse({ redirectToCustomDomain: true }).success, true);
  assert.equal(storeDomainUpdateSchema.safeParse({ redirectToCustomDomain: false }).success, true);
  assert.equal(storeDomainUpdateSchema.safeParse({}).success, true);
  for (const bad of ['true', 1, null, 'on']) assert.equal(storeDomainUpdateSchema.safeParse({ redirectToCustomDomain: bad }).success, false, String(bad));
  for (const extra of [{ domain: 'x.com' }, { customDomainStatus: 'verified' }, { domainToken: 't' }]) assert.equal(storeDomainUpdateSchema.safeParse(extra).success, false);
});

test('the PATCH body accepts the domain group, strictly, and counts as a change', () => {
  assert.equal(storeSettingsUpdateSchema.safeParse({ domain: { redirectToCustomDomain: true } }).success, true);
  assert.deepEqual(failingPaths(storeSettingsUpdateSchema.safeParse({ domain: { redirectToCustomDomain: 'yes' } })), ['domain.redirectToCustomDomain']);
  assert.equal(storeSettingsUpdateSchema.safeParse({ customDomainStatus: 'verified' }).success, false);
});

test('the settings the screen reads may carry the domain group (an older backend without it still parses)', () => {
  const shape = (storeSettingsSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.ok('domain' in shape);
});

test('the readiness checklist knows an optional domain step; the six required items come first', () => {
  assert.deepEqual([...STORE_READINESS_ITEMS], ['profile', 'delivery', 'payment', 'payout', 'product', 'email', 'domain']);
  const six = ['profile', 'delivery', 'payment', 'payout', 'product', 'email'].map((key) => ({ key, ok: true, label: key, tab: key }));
  assert.equal(storeReadinessSchema.safeParse({ ready: true, status: 'pending', items: six, missing: [] }).success, true);
  const withDomain = [...six, { key: 'domain', ok: false, label: 'Finish connecting your own domain', tab: 'domain', optional: true }];
  assert.equal(storeReadinessSchema.safeParse({ ready: true, status: 'pending', items: withDomain, missing: [] }).success, true);
});

const store = {
  id: '65a000000000000000000011',
  slug: 'zara',
  internalHandle: null,
  name: 'Zara',
  status: 'active',
  isThemeDemo: false,
  branding: { logoUrl: null, announcementText: null, heroBanners: [] },
  seo: { title: null, description: null, imageUrl: null },
  commerce: { currency: 'PKR', codEnabled: true, cardEnabled: false, deliveryRate: 0, freeDeliveryThreshold: null, whatsappNumber: null },
  features: { socialProofEnabled: false },
  theme: { activeTheme: null },
};

test('the public store record carries the verified domain and the redirect flag, both optional', () => {
  assert.equal(storefrontStoreSchema.safeParse(store).success, true, 'an older backend without them');
  assert.equal(storefrontStoreSchema.safeParse({ ...store, customDomain: 'shop.zara.pk', redirectToCustomDomain: true }).success, true);
  assert.equal(storefrontStoreSchema.safeParse({ ...store, customDomain: null, redirectToCustomDomain: false }).success, true);
  assert.equal(storefrontStoreSchema.safeParse({ ...store, redirectToCustomDomain: 'yes' }).success, false);
});
