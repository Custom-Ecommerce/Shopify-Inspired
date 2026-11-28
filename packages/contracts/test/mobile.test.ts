import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOBILE_IDEMPOTENCY_KEY_PATTERN,
  MOBILE_PAGE_MAX,
  mobileAdminLoginRequestSchema,
  mobileAlertSchema,
  mobileCustomerSchema,
  mobileDashboardSchema,
  mobileLoginRequestSchema,
  mobileOrderDetailSchema,
  mobileOrderListItemSchema,
  mobilePriceRequestSchema,
  mobileProductDetailSchema,
  mobileProductListItemSchema,
  mobilePushSettingsUpdateSchema,
  mobilePushTokenRequestSchema,
  mobileRefreshRequestSchema,
  mobileStockRequestSchema,
  mobileStoreSchema,
  mobileVariantSchema,
} from '../src/index';

// Sprint 9 (EP-31.US03.T04): the frozen wire shapes of the phone apps.

const OID = '65a000000000000000000001';

test('every record the app reads has a revision and updatedAt in its contract', () => {
  const records = {
    store: mobileStoreSchema,
    orderListItem: mobileOrderListItemSchema,
    orderDetail: mobileOrderDetailSchema,
    productListItem: mobileProductListItemSchema,
    productDetail: mobileProductDetailSchema,
    variant: mobileVariantSchema,
    customer: mobileCustomerSchema,
    alert: mobileAlertSchema,
    dashboard: mobileDashboardSchema,
  };
  for (const [name, schema] of Object.entries(records)) {
    const shape = (schema as unknown as { shape: Record<string, { safeParse(v: unknown): { success: boolean } }> }).shape;
    assert.ok(shape.revision && shape.updatedAt, name);
    assert.equal(shape.revision.safeParse(undefined).success, false, name + ': revision is not optional');
    assert.equal(shape.revision.safeParse(-1).success, false, name);
    assert.equal(shape.updatedAt.safeParse(undefined).success, false, name);
  }
});

test('the contract files of the apps stay free of Node and server imports', () => {
  for (const file of ['mobile.ts', 'mobile-data.ts']) {
    const source = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
    for (const match of source.matchAll(/from '([^']+)'/g)) assert.ok(match[1] === 'zod' || match[1]!.startsWith('./'), file + ' imports ' + match[1]);
  }
});

test('sign-in bodies are strict and name the phone', () => {
  const good = { email: ' Ayesha@Example.com ', password: 'x', deviceName: 'Pixel', platform: 'android', appVersion: '1.2.3' };
  assert.equal(mobileLoginRequestSchema.parse(good).email, 'ayesha@example.com');
  for (const bad of [{ platform: 'ios' }, { appVersion: '' }, { deviceName: '   ' }, { installationId: 'x' }, { admin: true }]) {
    assert.equal(mobileLoginRequestSchema.safeParse({ ...good, ...bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(mobileAdminLoginRequestSchema.safeParse({ ...good, totp: '12345' }).success, false);
  assert.equal(mobileAdminLoginRequestSchema.safeParse({ ...good, totp: '123456' }).success, true);
  assert.equal(mobileRefreshRequestSchema.safeParse({ refreshToken: '' }).success, false);
});

test('the write bodies: an absolute whole count, whole rupees, a revision always', () => {
  assert.equal(mobileStockRequestSchema.safeParse({ revision: 1, variantId: OID, quantity: 5 }).success, true);
  for (const bad of [{ quantity: -1 }, { quantity: 1.5 }, { delta: 2 }, { revision: undefined }]) {
    assert.equal(mobileStockRequestSchema.safeParse({ revision: 1, variantId: OID, quantity: 5, ...bad }).success, false, JSON.stringify(bad));
  }
  const price = mobilePriceRequestSchema.parse({ revision: 1, variantId: OID, price: 1499.6 });
  assert.equal(price.price, 1500);
  assert.equal(price.compareAtPrice, undefined, 'left out keeps the stored value');
  assert.equal(mobilePriceRequestSchema.parse({ revision: 1, variantId: OID, price: 10, compareAtPrice: null }).compareAtPrice, null);
  assert.equal(MOBILE_PAGE_MAX, 50);
  assert.ok(MOBILE_IDEMPOTENCY_KEY_PATTERN.test('0b0c9a0e-4a1d-4f2e-9a51-3c6a1f8f9b10'));
  assert.equal(MOBILE_IDEMPOTENCY_KEY_PATTERN.test('short'), false);
});

test('push bodies: an Expo token or null, and only known kinds', () => {
  assert.equal(mobilePushTokenRequestSchema.safeParse({ token: 'ExponentPushToken[aaaaaaaaaaaaaaaa]' }).success, true);
  assert.equal(mobilePushTokenRequestSchema.safeParse({ token: null }).success, true);
  assert.equal(mobilePushTokenRequestSchema.safeParse({ token: 'abc' }).success, false);
  assert.equal(mobilePushSettingsUpdateSchema.safeParse({ mutedKinds: ['low_stock'] }).success, true);
  assert.equal(mobilePushSettingsUpdateSchema.safeParse({ mutedKinds: ['spam'] }).success, false);
  assert.equal(mobilePushSettingsUpdateSchema.safeParse({}).success, false);
});

test('quiet hours are two different 24 hour times, or null to remove them', () => {
  const ok = (body: unknown) => mobilePushSettingsUpdateSchema.safeParse(body).success;
  assert.equal(ok({ quietHours: { start: '22:00', end: '07:00' } }), true);
  assert.equal(ok({ quietHours: null }), true);
  for (const bad of [{ start: '24:00', end: '07:00' }, { start: '7:00', end: '08:00' }, { start: '10:00', end: '10:00' }, { start: '10:00' }]) {
    assert.equal(ok({ quietHours: bad }), false, JSON.stringify(bad));
  }
});
