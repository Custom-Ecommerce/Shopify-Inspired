
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueSyncEvent,
  MAX_REVISION_ATTEMPTS,
  registerSyncOutboxModel,
  type SyncOutboxModelPort,
} from '@markaz/sync-core';

type Row = Record<string, unknown>;

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const INPUT = {
  target: 'seller' as const,
  entity: 'store',
  entityId: 'store-1',
  group: 'governance',
  payload: { status: 'suspended' },
};

function dupKey(): Error {
  return Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
}

interface Fake {
  port: SyncOutboxModelPort;
  created: Row[];
  filters: Row[];
  findCalls(): number;
  createCalls(): number;
}

function fakeModel(opts: {
  headRevisions: Array<number | null>;
  createBehaviour?: (call: number) => Error | null;
}): Fake {
  const created: Row[] = [];
  const filters: Row[] = [];
  let finds = 0;
  let creates = 0;
  const port = {
    find: () => {
      throw new Error('find is not used by enqueueSyncEvent');
    },
    findOne: (filter: Row) => {
      filters.push(filter);
      const index = Math.min(finds, opts.headRevisions.length - 1);
      finds += 1;
      const value = opts.headRevisions[index];
      const chain = {
        sort: () => chain,
        lean: () => chain,
        exec: async () => (value === null ? null : { revision: value }),
      };
      return chain;
    },
    create: async (doc: Row) => {
      creates += 1;
      const failure = opts.createBehaviour ? opts.createBehaviour(creates) : null;
      if (failure) throw failure;
      const saved = { _id: 'id-' + creates, ...doc };
      created.push(saved);
      return saved;
    },
    updateOne: async () => ({}),
    updateMany: async () => ({}),
  } as unknown as SyncOutboxModelPort;
  return { port, created, filters, findCalls: () => finds, createCalls: () => creates };
}

beforeEach(() => {
  registerSyncOutboxModel(fakeModel({ headRevisions: [null] }).port);
});

test('a first event is written as a pending row at revision 1 with a ULID event id', async () => {
  const fake = fakeModel({ headRevisions: [null] });
  registerSyncOutboxModel(fake.port);
  const result = await enqueueSyncEvent(INPUT);
  assert.equal(result.revision, 1);
  assert.match(result.eventId, ULID);
  assert.equal(fake.created[0].status, 'pending');
  assert.equal(fake.created[0].attempts, 0);
  assert.equal(fake.created[0].target, 'seller');
  assert.ok(fake.created[0].nextAttemptAt instanceof Date);
});

test('the revision is one above the head for the same entity, entityId and group', async () => {
  const fake = fakeModel({ headRevisions: [7] });
  registerSyncOutboxModel(fake.port);
  const result = await enqueueSyncEvent(INPUT);
  assert.equal(result.revision, 8);
  assert.deepEqual(fake.filters[0], { entity: 'store', entityId: 'store-1', group: 'governance' });
});

test('a duplicate-key collision re-reads the head and retries with the new revision', async () => {
  const fake = fakeModel({
    headRevisions: [3, 4],
    createBehaviour: (call) => (call === 1 ? dupKey() : null),
  });
  registerSyncOutboxModel(fake.port);
  const result = await enqueueSyncEvent(INPUT);
  assert.equal(result.revision, 5);
  assert.equal(fake.findCalls(), 2);
  assert.equal(fake.created.length, 1);
});

test('after MAX_REVISION_ATTEMPTS collisions the call fails with a clear error', async () => {
  const fake = fakeModel({ headRevisions: [1], createBehaviour: () => dupKey() });
  registerSyncOutboxModel(fake.port);
  await assert.rejects(enqueueSyncEvent(INPUT), /could not allocate a revision/);
  assert.equal(fake.createCalls(), MAX_REVISION_ATTEMPTS);
});

test('errors other than a duplicate key are not retried', async () => {
  const fake = fakeModel({ headRevisions: [1], createBehaviour: () => new Error('disk full') });
  registerSyncOutboxModel(fake.port);
  await assert.rejects(enqueueSyncEvent(INPUT), /disk full/);
  assert.equal(fake.createCalls(), 1);
});

test('invalid input is rejected before the database is touched', async () => {
  const fake = fakeModel({ headRevisions: [null] });
  registerSyncOutboxModel(fake.port);
  await assert.rejects(enqueueSyncEvent({ ...INPUT, group: '  ' }), /group is required/);
  await assert.rejects(enqueueSyncEvent({ ...INPUT, target: 'other' as never }), /unsupported target/);
  assert.equal(fake.findCalls(), 0);
  assert.equal(fake.createCalls(), 0);
});
