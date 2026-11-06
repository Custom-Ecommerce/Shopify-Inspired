import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeSchema } from '../src/store';
import { failingPaths } from './helpers';

const OID = '65a000000000000000000001';
const NOW = '2026-10-01T00:00:00.000Z';

function store(overrides: Record<string, unknown> = {}) {
  return {
    id: OID,
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    commissionRate: 4,
    govRevision: 1,
    opsRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('a store with typed storefront, payment, and billing sub-objects parses', () => {
  const full = store({
    storefront: {
      announcementText: 'Sale',
      whatsappNumber: '03001234567',
      deliveryRate: 200,
      freeDeliveryThreshold: 5000,
      activeTheme: 'stiletto',
      logo: { id: OID, url: 'https://cdn.example.com/logo.png' },
      seoTitle: 'Acme',
      seoDescription: 'Shop',
      seoImage: OID,
    },
    paymentSettings: { codEnabled: true, cardEnabled: false },
    billing: { stripeOnboardingStatus: 'complete', stripeChargesEnabled: true },
  });
  assert.equal(storeSchema.safeParse(full).success, true);
});

test('a non-boolean codEnabled is reported against paymentSettings.codEnabled', () => {
  const bad = store({ paymentSettings: { codEnabled: 'yes' } });
  assert.deepEqual(failingPaths(storeSchema.safeParse(bad)), ['paymentSettings.codEnabled']);
});

test('a negative delivery rate is accepted as a number, so only the type is enforced here', () => {
  assert.equal(storeSchema.safeParse(store({ storefront: { deliveryRate: 0 } })).success, true);
});
