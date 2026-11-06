import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncOutbox } from '../src';

test('sync-outbox enforces one row per (entity, entityId, group, revision)', () => {
const wanted = JSON.stringify({ entity: 1, entityId: 1, group: 1, revision: 1 });
const match = SyncOutbox.schema.indexes().find(([fields]) => JSON.stringify(fields) === wanted);

assert.ok(match, 'compound revision index is declared');
assert.equal((match[1] as { unique?: boolean }).unique, true);
});

test('eventId stays unique', () => {
const path = SyncOutbox.schema.path('eventId') as unknown as { options: { unique?: boolean } };
assert.equal(path.options.unique, true);
});
