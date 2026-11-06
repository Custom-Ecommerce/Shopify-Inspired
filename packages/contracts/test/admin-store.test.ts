import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminStoreDetailSchema,
  adminStoreListEnvelopeSchema,
  storeStatusChangeRequestSchema,
  storeStatusChangeResponseSchema,
} from '../src/admin-store';

const OID = '65a000000000000000000001';
const NOW = '2026-10-11T10:00:00.000Z';

const listItem = {
  id: OID,
  name: 'Lahore Looms',
  slug: 'lahore-looms',
  status: 'active',
  domain: null,
  isThemeDemo: false,
  commissionRate: 5,
  commissionMode: 'inherit',
  owner: { id: OID, name: 'Owner', email: 'owner@example.com' },
  statusChangedAt: null,
  createdAt: NOW,
};

test('a list envelope of store rows parses', () => {
  const envelope = { docs: [listItem], totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };
  assert.equal(adminStoreListEnvelopeSchema.safeParse(envelope).success, true);
});

test('a row carrying _id instead of id is refused', () => {
  const { id, ...rest } = listItem;
  void id;
  const envelope = { docs: [{ ...rest, _id: OID }], totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };
  assert.equal(adminStoreListEnvelopeSchema.safeParse(envelope).success, false);
});

test('a store detail with history parses', () => {
  const detail = {
    ...listItem,
    internalHandle: null,
    customDomainStatus: 'unset',
    suspensionReason: null,
    suspensionNote: null,
    suspendedAt: null,
    archivedAt: null,
    govRevision: 0,
    opsRevision: 0,
    activeTheme: null,
    stripeOnboardingStatus: null,
    stripeChargesEnabled: null,
    updatedAt: NOW,
    history: [{ id: OID, action: 'store.suspend', actor: { id: OID, name: 'Op' }, reason: 'chargebacks', note: null, from: 'active', to: 'suspended', createdAt: NOW }],
  };
  assert.equal(adminStoreDetailSchema.safeParse(detail).success, true);
});

test('the governance request needs a trimmed reason of at least 3 characters and only active or suspended', () => {
  assert.equal(storeStatusChangeRequestSchema.safeParse({ status: 'suspended', reason: '  ab  ' }).success, false);
  assert.equal(storeStatusChangeRequestSchema.safeParse({ status: 'suspended' }).success, false);
  assert.equal(storeStatusChangeRequestSchema.safeParse({ status: 'archived', reason: 'because' }).success, false);
  const ok = storeStatusChangeRequestSchema.safeParse({ status: 'suspended', reason: '  policy breach  ' });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.reason, 'policy breach');
});

test('the governance response parses with and without a queued event', () => {
  const store = { id: OID, status: 'suspended', suspensionReason: 'x', suspensionNote: null, suspendedAt: NOW, statusChangedAt: NOW };
  assert.equal(storeStatusChangeResponseSchema.safeParse({ store, queued: { eventId: 'evt_1', revision: 2 } }).success, true);
  assert.equal(storeStatusChangeResponseSchema.safeParse({ store, queued: null }).success, true);
});
