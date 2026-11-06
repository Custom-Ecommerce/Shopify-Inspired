import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAuditListSchema, adminSellerListEnvelopeSchema, adminSyncOutboxSchema } from '../src/admin-ops';

const OID = '65a000000000000000000001';
const NOW = '2026-10-11T10:00:00.000Z';
const meta = { totalDocs: 1, totalPages: 1, page: 1, limit: 20, hasNextPage: false, hasPrevPage: false };

test('a seller list envelope parses, and a row with _id instead of id is refused', () => {
  const row = { id: OID, name: 'Owner', email: 'owner@example.com', stores: [{ id: OID, name: 'Looms', status: 'active' }], storeCount: 1, createdAt: NOW };
  assert.equal(adminSellerListEnvelopeSchema.safeParse({ docs: [row], ...meta }).success, true);
  const { id, ...rest } = row;
  void id;
  assert.equal(adminSellerListEnvelopeSchema.safeParse({ docs: [{ ...rest, _id: OID }], ...meta }).success, false);
});

test('a sync outbox answer needs the counts, the filter status, and an event envelope', () => {
  const event = {
    id: OID,
    eventId: 'evt_1',
    target: 'seller',
    entity: 'store',
    entityId: OID,
    group: 'governance',
    revision: 3,
    status: 'dead',
    attempts: 8,
    nextAttemptAt: null,
    lastError: 'receiver answered 500',
    sentAt: null,
    createdAt: NOW,
  };
  const body = { counts: { pending: 1, sent: 20, dead: 1 }, oldestPendingAt: NOW, lastSentAt: NOW, status: 'dead', events: { docs: [event], ...meta } };
  assert.equal(adminSyncOutboxSchema.safeParse(body).success, true);
  assert.equal(adminSyncOutboxSchema.safeParse({ ...body, status: 'failed' }).success, false);
  assert.equal(adminSyncOutboxSchema.safeParse({ ...body, counts: { pending: 1 } }).success, false);
});

test('an audit list carries its entries and the action facets', () => {
  const entry = { id: OID, action: 'store.suspend', entity: 'store', entityId: OID, actor: { id: OID, name: 'Op' }, reason: 'chargebacks', note: null, from: 'active', to: 'suspended', createdAt: NOW };
  assert.equal(adminAuditListSchema.safeParse({ docs: [entry], ...meta, facets: { actions: ['store.suspend'] } }).success, true);
  assert.equal(adminAuditListSchema.safeParse({ docs: [entry], ...meta }).success, false);
});
