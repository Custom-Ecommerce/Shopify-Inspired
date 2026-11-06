
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncEnvelopeSchema, SYNC_ENTITIES, SYNC_GROUPS, SYNC_SOURCES, SYNC_OPS } from '../src/sync-envelope';
import { failingPaths } from './helpers';

const HASH = '0'.repeat(64);

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    source: 'admin',
    entity: 'store',
    entityId: '65a000000000000000000001',
    group: 'governance',
    revision: 2,
    occurredAt: '2026-10-01T00:00:00.000Z',
    op: 'upsert',
    data: { status: 'suspended' },
    dataHash: HASH,
    ...overrides,
  };
}

test('a well-formed envelope parses', () => {
  assert.equal(syncEnvelopeSchema.safeParse(validEnvelope()).success, true);
});

test('a revision of zero is reported against revision', () => {
  assert.deepEqual(failingPaths(syncEnvelopeSchema.safeParse(validEnvelope({ revision: 0 }))), ['revision']);
});

test('an eventId that is not a ULID is reported against eventId', () => {
  assert.deepEqual(failingPaths(syncEnvelopeSchema.safeParse(validEnvelope({ eventId: 'not-a-ulid' }))), ['eventId']);
});

test('an uppercase dataHash is reported against dataHash', () => {
  assert.deepEqual(
    failingPaths(syncEnvelopeSchema.safeParse(validEnvelope({ dataHash: 'A'.repeat(64) }))),
    ['dataHash'],
  );
});

test('an unknown group is reported against group', () => {
  assert.deepEqual(failingPaths(syncEnvelopeSchema.safeParse(validEnvelope({ group: 'billing' }))), ['group']);
});

test('a schema version other than 1 is reported against schemaVersion', () => {
  assert.deepEqual(
    failingPaths(syncEnvelopeSchema.safeParse(validEnvelope({ schemaVersion: 2 }))),
    ['schemaVersion'],
  );
});

test('the enum sets match platform-kit', () => {
  assert.deepEqual([...SYNC_SOURCES], ['admin', 'seller']);
  assert.deepEqual([...SYNC_ENTITIES], ['store', 'seller', 'platform']);
  assert.deepEqual([...SYNC_GROUPS], ['governance', 'operations', 'profile', 'controls', 'settings']);
  assert.deepEqual([...SYNC_OPS], ['upsert']);
});
