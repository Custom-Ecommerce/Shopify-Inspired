
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeSchema, STORE_STATUSES, COMMISSION_MODES } from '../src/store';
import { failingPaths } from './helpers';

const OID = '65a000000000000000000001';
const NOW = '2026-10-01T00:00:00.000Z';

function validStore(overrides: Record<string, unknown> = {}) {
  return {
    id: OID,
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    commissionRate: 4,
    govRevision: 3,
    opsRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// The B3 model's field set, copied from packages/db-schemas/src/models/store.ts.
const MODEL_FIELDS = [
  'id', 'name', 'slug', 'internalHandle', 'domain', 'customDomainStatus', 'isThemeDemo', 'owner',
  'status', 'suspensionReason', 'suspensionNote', 'suspendedAt', 'statusChangedAt', 'commissionRate',
  'commissionMode', 'govRevision', 'opsRevision', 'archivedAt', 'registrationId', 'provisioningState',
  'referralCode', 'referredBy', 'storefront', 'courierSettings', 'paymentSettings', 'billing',
  'createdAt', 'updatedAt',
];

test('a store that matches the model parses', () => {
  assert.equal(storeSchema.safeParse(validStore()).success, true);
});

test('the schema covers exactly the B3 model fields, no more and no fewer', () => {
  assert.deepEqual(Object.keys(storeSchema.shape).sort(), [...MODEL_FIELDS].sort());
});

test('the status set is the model set, with archived included', () => {
  assert.deepEqual([...STORE_STATUSES], ['pending', 'active', 'suspended', 'archived']);
});

test('the commission mode set is the model set', () => {
  assert.deepEqual([...COMMISSION_MODES], ['inherit', 'custom']);
});

test('a missing name is reported against name', () => {
  const { name: _omit, ...rest } = validStore();
  assert.deepEqual(failingPaths(storeSchema.safeParse(rest)), ['name']);
});

test('an unknown status is reported against status', () => {
  assert.deepEqual(failingPaths(storeSchema.safeParse(validStore({ status: 'deleted' }))), ['status']);
});

test('a negative govRevision is reported against govRevision', () => {
  assert.deepEqual(failingPaths(storeSchema.safeParse(validStore({ govRevision: -1 }))), ['govRevision']);
});

test('a non-integer opsRevision is reported against opsRevision', () => {
  assert.deepEqual(failingPaths(storeSchema.safeParse(validStore({ opsRevision: 1.5 }))), ['opsRevision']);
});

test('an owner that is not an ObjectId is reported against owner', () => {
  assert.deepEqual(failingPaths(storeSchema.safeParse(validStore({ owner: 'not-an-id' }))), ['owner']);
});

test('an unknown commission mode is reported against commissionMode', () => {
  assert.deepEqual(failingPaths(storeSchema.safeParse(validStore({ commissionMode: 'percent' }))), ['commissionMode']);
});

test('a missing commissionRate is reported against commissionRate', () => {
  const { commissionRate: _omit, ...rest } = validStore();
  assert.deepEqual(failingPaths(storeSchema.safeParse(rest)), ['commissionRate']);
});
