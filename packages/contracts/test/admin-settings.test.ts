import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_SETTINGS_FIELDS,
  adminPlatformSettingsSchema,
  adminSettingsResponseSchema,
  adminSettingsUpdateRequestSchema,
  adminSettingsUpdateResponseSchema,
} from '../src/admin-settings';
import { failingPaths } from './helpers';

const NOW = '2026-10-11T10:00:00.000Z';
const settings = { defaultCommissionRate: 4, maxStoresPerSeller: 3, stripeCommissionNote: null, settingsRevision: 2, updatedAt: NOW };

test('the settings answer parses, with a null note and a null update time', () => {
  assert.equal(adminSettingsResponseSchema.safeParse({ settings }).success, true);
  assert.equal(adminSettingsResponseSchema.safeParse({ settings: { ...settings, stripeCommissionNote: 'Fees by Stripe', updatedAt: null } }).success, true);
});

test('the settings answer refuses a rate outside 0 to 100, a bad limit, or a negative revision', () => {
  const bad: unknown[] = [
    { ...settings, defaultCommissionRate: -0.1 },
    { ...settings, defaultCommissionRate: 100.5 },
    { ...settings, defaultCommissionRate: '4' },
    { ...settings, maxStoresPerSeller: 0 },
    { ...settings, maxStoresPerSeller: 2.5 },
    { ...settings, settingsRevision: -1 },
    { ...settings, updatedAt: 'yesterday' },
  ];
  for (const body of bad) assert.equal(adminPlatformSettingsSchema.safeParse(body).success, false, JSON.stringify(body));
  assert.deepEqual(failingPaths(adminPlatformSettingsSchema.safeParse({ ...settings, maxStoresPerSeller: 0 })), ['maxStoresPerSeller']);
});

test('update accepts any one setting, or all three, with an optional reason', () => {
  const good: unknown[] = [
    { defaultCommissionRate: 5 },
    { defaultCommissionRate: 0 },
    { defaultCommissionRate: 100 },
    { defaultCommissionRate: 2.5 },
    { maxStoresPerSeller: 10 },
    { stripeCommissionNote: null },
    { stripeCommissionNote: 'Stripe takes its own fee on top.' },
    { defaultCommissionRate: 5, maxStoresPerSeller: 4, stripeCommissionNote: 'x', reason: 'Q4 pricing' },
  ];
  for (const body of good) assert.equal(adminSettingsUpdateRequestSchema.safeParse(body).success, true, JSON.stringify(body));
});

test('update needs at least one setting: an empty body or a reason alone is refused', () => {
  assert.equal(adminSettingsUpdateRequestSchema.safeParse({}).success, false);
  assert.equal(adminSettingsUpdateRequestSchema.safeParse({ reason: 'because' }).success, false);
});

test('update refuses bad values and unknown fields, settingsRevision and updatedAt included', () => {
  const bad: unknown[] = [
    { defaultCommissionRate: -1 },
    { defaultCommissionRate: 101 },
    { defaultCommissionRate: '5' },
    { defaultCommissionRate: null },
    { maxStoresPerSeller: 0 },
    { maxStoresPerSeller: 1001 },
    { maxStoresPerSeller: 1.5 },
    { stripeCommissionNote: 'x'.repeat(501) },
    { stripeCommissionNote: 5 },
    { defaultCommissionRate: 5, reason: '' },
    { defaultCommissionRate: 5, reason: '   ' },
    { defaultCommissionRate: 5, reason: 'x'.repeat(501) },
    { defaultCommissionRate: 5, settingsRevision: 9 },
    { defaultCommissionRate: 5, updatedAt: NOW },
    { defaultCommissionRate: 5, _id: '65a000000000000000000001' },
  ];
  for (const body of bad) assert.equal(adminSettingsUpdateRequestSchema.safeParse(body).success, false, JSON.stringify(body));
});

test('the update answer carries the settings and the queued event, or null', () => {
  assert.equal(adminSettingsUpdateResponseSchema.safeParse({ settings, queued: null }).success, true);
  assert.equal(adminSettingsUpdateResponseSchema.safeParse({ settings, queued: { eventId: '01JABCDEFGHJKMNPQRSTVWXYZ0', revision: 3 } }).success, true);
  assert.equal(adminSettingsUpdateResponseSchema.safeParse({ settings }).success, false);
  assert.equal(adminSettingsUpdateResponseSchema.safeParse({ settings, queued: { eventId: '', revision: 3 } }).success, false);
  assert.equal(adminSettingsUpdateResponseSchema.safeParse({ settings, queued: { eventId: 'e', revision: 0 } }).success, false);
});

test('the writable field list is the three settings the policy matrix allows, and no revision', () => {
  assert.deepEqual([...ADMIN_SETTINGS_FIELDS], ['defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote']);
});
