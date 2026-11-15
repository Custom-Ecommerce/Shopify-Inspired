import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as syncCoreNs from '@markaz/sync-core';
import { unwrapCjs } from '@/lib/cjs';
import type { SyncEnvelope } from '@markaz/sync-core';
import { PlatformSettingsModel } from '@/lib/services';
import { readPlatformSettings } from '../src/lib/platform-settings';
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
  assert.deepEqual(await readPlatformSettings(), { storeApprovalRequired: true, defaultCommissionRate: 9 });
});

test('readPlatformSettings: with no document the environment answers, then the defaults', async () => {
  assert.deepEqual(await readPlatformSettings(), { storeApprovalRequired: false, defaultCommissionRate: 4 });
  process.env.PLATFORM_STORE_APPROVAL_REQUIRED = 'true';
  process.env.PLATFORM_DEFAULT_COMMISSION_PERCENT = '5';
  assert.deepEqual(await readPlatformSettings(), { storeApprovalRequired: true, defaultCommissionRate: 5 });
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
