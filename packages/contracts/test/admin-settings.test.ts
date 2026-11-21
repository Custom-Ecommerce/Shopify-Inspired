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

test('the writable field list is the four settings the policy matrix allows, and no revision', () => {
  assert.deepEqual([...ADMIN_SETTINGS_FIELDS], ['defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote', 'storeApprovalRequired']);
});

// Sprint 6 (D-116, D-118): the COD commission percent and the plan settings.

test('the settings answer of an older backend (no Sprint 6 fields) parses with the defaults', () => {
  const parsed = adminPlatformSettingsSchema.parse(settings);
  assert.equal(parsed.codCommissionPercent, 0);
  assert.equal(parsed.paymentInstructions, null);
  assert.equal(parsed.graceDays, 7);
  assert.equal(parsed.trialDays, 0);
  assert.equal(parsed.supportEmail, null);
  assert.equal(parsed.supportPhone, null);
});

test('the settings answer carries the Sprint 6 fields and refuses a COD percent outside 0 to 100', () => {
  const full = { ...settings, codCommissionPercent: 2.5, paymentInstructions: 'Bank: 123', graceDays: 30, trialDays: 60, supportEmail: 'help@example.com', supportPhone: '+92 300 1234567' };
  assert.equal(adminPlatformSettingsSchema.safeParse(full).success, true);
  for (const bad of [{ codCommissionPercent: -1 }, { codCommissionPercent: 100.1 }, { graceDays: 31 }, { graceDays: 1.5 }, { trialDays: 61 }, { trialDays: -1 }]) {
    assert.equal(adminPlatformSettingsSchema.safeParse({ ...settings, ...bad }).success, false, JSON.stringify(bad));
  }
});

test('ADMIN_SETTINGS_FIELDS lists the Sprint 6 settings after the original four', () => {
  assert.deepEqual([...ADMIN_SETTINGS_FIELDS].slice(0, 4), ['defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote', 'storeApprovalRequired']);
  for (const field of ['codCommissionPercent', 'paymentInstructions', 'graceDays', 'trialDays', 'supportEmail', 'supportPhone']) {
    assert.ok((ADMIN_SETTINGS_FIELDS as readonly string[]).includes(field), field);
  }
});

test('update accepts each Sprint 6 setting alone, at its bounds, and a blank text to clear it', () => {
  const good: unknown[] = [
    { codCommissionPercent: 0 },
    { codCommissionPercent: 4 },
    { codCommissionPercent: 100 },
    { paymentInstructions: 'Pay to Meezan 0123, then send the slip.' },
    { paymentInstructions: 'x'.repeat(1000) },
    { paymentInstructions: null },
    { paymentInstructions: '' },
    { graceDays: 0 },
    { graceDays: 30 },
    { trialDays: 0 },
    { trialDays: 60 },
    { supportEmail: 'help@example.com' },
    { supportEmail: null },
    { supportPhone: '0300-1234567' },
    { supportPhone: null },
    { codCommissionPercent: 2, graceDays: 10, reason: 'Plan launch' },
  ];
  for (const body of good) assert.equal(adminSettingsUpdateRequestSchema.safeParse(body).success, true, JSON.stringify(body));
});

test('update refuses bad Sprint 6 values', () => {
  const bad: unknown[] = [
    { codCommissionPercent: -1 },
    { codCommissionPercent: 100.5 },
    { codCommissionPercent: '2' },
    { codCommissionPercent: null },
    { paymentInstructions: 'x'.repeat(1001) },
    { paymentInstructions: 5 },
    { graceDays: -1 },
    { graceDays: 31 },
    { graceDays: 2.5 },
    { graceDays: null },
    { trialDays: 61 },
    { trialDays: -1 },
    { trialDays: 1.5 },
    { supportEmail: 'not an email' },
    { supportEmail: 'a@b' },
    { supportEmail: 'x'.repeat(250) + '@example.com' },
    { supportPhone: 'call me maybe' },
    { supportPhone: '1'.repeat(31) },
  ];
  for (const body of bad) assert.equal(adminSettingsUpdateRequestSchema.safeParse(body).success, false, JSON.stringify(body));
});
