import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as syncCoreNs from '@markaz/sync-core';
import { unwrapCjs } from '@/lib/cjs';
import type { SyncEnvelope } from '@markaz/sync-core';
import { PlatformSettingsModel } from '@/lib/services';
import { readPlanSettings, readPlatformSettings, readReferralSettings } from '../src/lib/platform-settings';
import { quoteDelivery } from '@/lib/contracts';
import { computeTotals } from '../src/lib/storefront/pricing';

const syncCore: any = unwrapCjs(syncCoreNs);
const { createMongooseSyncPersistence, StaleRevisionError } = syncCore;

// D-098 A1: the seller backend keeps the platform settings the admin console sends, and reads them with fallbacks.
// The model is stubbed in memory; no database.

const Model = PlatformSettingsModel as any;
let docs: Array<Record<string, any>>;
let restore: () => void = () => {};

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, lean: async () => value() };
  return q;
};

function guardPasses(doc: Record<string, any>, or: any[]): boolean {
  return or.some((c) => {
    if (c.settingsRevision?.$lt !== undefined) return typeof doc.settingsRevision === 'number' && doc.settingsRevision < c.settingsRevision.$lt;
    if (c.settingsRevision?.$exists === false) return doc.settingsRevision === undefined;
    return doc.settingsRevision === undefined || doc.settingsRevision === null;
  });
}

beforeEach(() => {
  docs = [];
  const saved = { findOne: Model.findOne, updateOne: Model.updateOne, exists: Model.exists };
  Model.findOne = () => chain(() => (docs[0] ? structuredClone(docs[0]) : null));
  Model.exists = async () => (docs[0] ? { _id: 'x' } : null);
  Model.updateOne = async (filter: any, update: any, options: any = {}) => {
    const doc = docs[0];
    if (doc && filter.$or) {
      if (!guardPasses(doc, filter.$or)) return { matchedCount: 0 };
      Object.assign(doc, update.$set);
      return { matchedCount: 1 };
    }
    if (!doc && options.upsert) {
      docs.push({ ...update.$setOnInsert });
      return { matchedCount: 0 };
    }
    return { matchedCount: 0 };
  };
  restore = () => Object.assign(Model, saved);
});

afterEach(() => {
  restore();
  delete process.env.PLATFORM_STORE_APPROVAL_REQUIRED;
  delete process.env.PLATFORM_DEFAULT_COMMISSION_PERCENT;
  delete process.env.COD_COMMISSION_PERCENT;
});

const envelope = (revision: number, data: Record<string, unknown>): SyncEnvelope =>
  ({ entity: 'platform', entityId: 'platform', group: 'settings', revision, data, eventId: 'e' + revision, source: 'admin', dataHash: 'h', op: 'upsert' }) as unknown as SyncEnvelope;

test('the first settings payload creates the document and records its revision', async () => {
  const persistence = createMongooseSyncPersistence();
  assert.equal(await persistence.load('platform', 'platform', 'settings'), null);
  await persistence.save(envelope(2, { defaultCommissionRate: 6, storeApprovalRequired: true, maxStoresPerSeller: 5 }));
  assert.equal(docs.length, 1);
  assert.equal(docs[0]!.settingsRevision, 2);
  assert.equal(docs[0]!.storeApprovalRequired, true);
  assert.equal(await persistence.load('platform', 'platform', 'settings'), 2);
});

test('a newer revision overwrites; an older or equal one is ignored (stale) and changes nothing', async () => {
  const persistence = createMongooseSyncPersistence();
  await persistence.save(envelope(3, { defaultCommissionRate: 6 }));
  await persistence.save(envelope(4, { defaultCommissionRate: 7 }));
  await assert.rejects(() => persistence.save(envelope(2, { defaultCommissionRate: 1 })), StaleRevisionError);
  await assert.rejects(() => persistence.save(envelope(4, { defaultCommissionRate: 1 })), StaleRevisionError);
  assert.equal(docs.length, 1);
  assert.equal(docs[0]!.defaultCommissionRate, 7);
  assert.equal(docs[0]!.settingsRevision, 4);
});

test('a field outside the settings allowlist is never written', async () => {
  const persistence = createMongooseSyncPersistence();
  await persistence.save(envelope(1, { defaultCommissionRate: 5, stripeCommissionNote: 'private note' }));
  assert.equal(docs[0]!.stripeCommissionNote, undefined);
});

test('readPlatformSettings: the settings document comes first', async () => {
  docs.push({ storeApprovalRequired: true, defaultCommissionRate: 9 });
  process.env.PLATFORM_STORE_APPROVAL_REQUIRED = 'false';
  assert.deepEqual(await readPlatformSettings(), { storeApprovalRequired: true, defaultCommissionRate: 9, codCommissionPercent: 0, maxStoresPerSeller: null });
});

test('readPlatformSettings: with no document the environment answers, then the defaults', async () => {
  assert.deepEqual(await readPlatformSettings(), { storeApprovalRequired: false, defaultCommissionRate: 4, codCommissionPercent: 0, maxStoresPerSeller: null });
  process.env.PLATFORM_STORE_APPROVAL_REQUIRED = 'true';
  process.env.PLATFORM_DEFAULT_COMMISSION_PERCENT = '5';
  assert.deepEqual(await readPlatformSettings(), { storeApprovalRequired: true, defaultCommissionRate: 5, codCommissionPercent: 0, maxStoresPerSeller: null });
  process.env.PLATFORM_DEFAULT_COMMISSION_PERCENT = 'abc';
  assert.equal((await readPlatformSettings()).defaultCommissionRate, 4);
});

test('readPlatformSettings: a value missing from the document falls back on its own', async () => {
  docs.push({ storeApprovalRequired: false });
  assert.equal((await readPlatformSettings()).defaultCommissionRate, 4);
});

test('the server prices delivery with the shared quoteDelivery, so the settings preview agrees with checkout', () => {
  const cityRates = { karachi: 400 };
  for (const [city, items] of [['Karachi', 3000], ['Lahore', 3000], ['Karachi', 5000], [null, 100], ['karachi', 4999]] as const) {
    const server = computeTotals([{ unitPrice: items, qty: 1, deliveryCharge: null }], { deliveryRate: 250, freeDeliveryThreshold: 5000, cityRates, city });
    const preview = quoteDelivery({ defaultRate: 250, freeOver: 5000, cityRates, city, itemsAfterDiscount: items });
    assert.equal(server.deliveryCharges, preview.charge, String(city) + ' ' + items);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 (D-116, D-118): the COD commission percent, the store limit and the plan settings.

test('Sprint 6: the COD percent comes from the document, then COD_COMMISSION_PERCENT, then 0', async () => {
  docs.push({ defaultCommissionRate: 4, codCommissionPercent: 2.5 });
  process.env.COD_COMMISSION_PERCENT = '7';
  assert.equal((await readPlatformSettings()).codCommissionPercent, 2.5);

  docs.length = 0;
  assert.equal((await readPlatformSettings()).codCommissionPercent, 7);
  process.env.COD_COMMISSION_PERCENT = 'abc';
  assert.equal((await readPlatformSettings()).codCommissionPercent, 0);
  process.env.COD_COMMISSION_PERCENT = '101';
  assert.equal((await readPlatformSettings()).codCommissionPercent, 0);
  delete process.env.COD_COMMISSION_PERCENT;
  assert.equal((await readPlatformSettings()).codCommissionPercent, 0);
});

test('Sprint 6: a document without the COD percent falls back on its own, and a stored 0 is a real 0 (not the env)', async () => {
  process.env.COD_COMMISSION_PERCENT = '3';
  docs.push({ defaultCommissionRate: 6 });
  assert.equal((await readPlatformSettings()).codCommissionPercent, 3);
  docs[0]!.codCommissionPercent = 0;
  assert.equal((await readPlatformSettings()).codCommissionPercent, 0);
  assert.equal((await readPlatformSettings()).defaultCommissionRate, 6);
});

test('Sprint 6: the platform store limit is read when it is a whole number of 1 or more, otherwise null', async () => {
  docs.push({ maxStoresPerSeller: 5 });
  assert.equal((await readPlatformSettings()).maxStoresPerSeller, 5);
  docs[0]!.maxStoresPerSeller = 0;
  assert.equal((await readPlatformSettings()).maxStoresPerSeller, null);
  docs[0]!.maxStoresPerSeller = 2.5;
  assert.equal((await readPlatformSettings()).maxStoresPerSeller, null);
});

test('Sprint 6: the sync receiver stores the COD percent and the plan settings, and a newer revision replaces them', async () => {
  const persistence = createMongooseSyncPersistence();
  await persistence.save(
    envelope(1, { codCommissionPercent: 2, paymentInstructions: 'Meezan 0123', graceDays: 10, trialDays: 14, supportEmail: 'help@example.com', supportPhone: '0300-1234567' }),
  );
  assert.equal(docs[0]!.codCommissionPercent, 2);
  assert.equal(docs[0]!.paymentInstructions, 'Meezan 0123');
  assert.equal(docs[0]!.graceDays, 10);
  await persistence.save(envelope(2, { codCommissionPercent: 0 }));
  assert.equal(docs[0]!.codCommissionPercent, 0);
  assert.equal(docs[0]!.graceDays, 10);
});

test('Sprint 6: readPlanSettings gives the defaults with no document: 7 days of grace, no trial, no texts', async () => {
  assert.deepEqual(await readPlanSettings(), { paymentInstructions: null, graceDays: 7, trialDays: 0, supportEmail: null, supportPhone: null });
});

test('Sprint 6: readPlanSettings reads the document, treats empty text as not set, and keeps the text unescaped (output escapes it)', async () => {
  docs.push({ paymentInstructions: 'Pay <b>here</b>', graceDays: 3, trialDays: 14, supportEmail: '', supportPhone: '0300-1234567' });
  assert.deepEqual(await readPlanSettings(), { paymentInstructions: 'Pay <b>here</b>', graceDays: 3, trialDays: 14, supportEmail: null, supportPhone: '0300-1234567' });
});

test('Sprint 6: readPlanSettings ignores unusable numbers', async () => {
  docs.push({ graceDays: 99, trialDays: -1 });
  const view = await readPlanSettings();
  assert.equal(view.graceDays, 7);
  assert.equal(view.trialDays, 0);
});

test('S8-B5: the referral settings default to 1 month and a cap of 5; 0 months is kept (referrals off); unusable values fall back', async () => {
  assert.deepEqual(await readReferralSettings(), { rewardMonths: 1, monthlyCap: 5 });
  docs.push({ referralRewardMonths: 0, referralMonthlyCap: 12 });
  assert.deepEqual(await readReferralSettings(), { rewardMonths: 0, monthlyCap: 12 });
  docs[0] = { referralRewardMonths: 99, referralMonthlyCap: -1 };
  assert.deepEqual(await readReferralSettings(), { rewardMonths: 1, monthlyCap: 5 });
});
