
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStaleRevision, processBatch, type SyncApplyHandler, type SyncEnvelope } from '../src/index';

const KEY = 'store|s1|governance';

function envelope(eventId: string, revision: number, status: string): SyncEnvelope {
  return {
    schemaVersion: 1,
    eventId,
    source: 'admin',
    entity: 'store',
    entityId: 's1',
    group: 'governance',
    revision,
    occurredAt: '2026-10-01T00:00:00.000Z',
    op: 'upsert',
    data: { status },
    dataHash: '0'.repeat(64),
  } as unknown as SyncEnvelope;
}

/** In-memory seller replica that applies the receiver's rules: duplicates by eventId, stale by revision. */
function replica(options: { failEventIds?: string[] } = {}) {
  const revisions = new Map<string, number>();
  const statuses = new Map<string, string>();
  const seen = new Set<string>();
  const apply: SyncApplyHandler = async (incoming) => {
    if (seen.has(incoming.eventId)) return 'duplicate';
    if (options.failEventIds && options.failEventIds.includes(incoming.eventId)) {
      throw new Error('storage unavailable');
    }
    const stored = revisions.has(KEY) ? (revisions.get(KEY) as number) : null;
    if (isStaleRevision(incoming.revision, stored)) return 'stale';
    seen.add(incoming.eventId);
    revisions.set(KEY, incoming.revision);
    statuses.set(KEY, String(incoming.data.status));
    return 'applied';
  };
  return { apply, revisions, statuses };
}

test('an ordered stream of revisions applies every change and leaves the replica at the head', async () => {
  const seller = replica();
  const result = await processBatch(
    { envelopes: [envelope('e1', 1, 'active'), envelope('e2', 2, 'suspended'), envelope('e3', 3, 'active')] },
    seller.apply,
  );
  assert.equal(result.applied, 3);
  assert.equal(seller.revisions.get(KEY), 3);
  assert.equal(seller.statuses.get(KEY), 'active');
});

test('replaying the same batch changes nothing and every envelope reports duplicate', async () => {
  const seller = replica();
  const batch = { envelopes: [envelope('e1', 1, 'active'), envelope('e2', 2, 'suspended')] };
  await processBatch(batch, seller.apply);
  const replay = await processBatch(batch, seller.apply);
  assert.equal(replay.duplicate, 2);
  assert.equal(replay.applied, 0);
  assert.equal(seller.revisions.get(KEY), 2);
});

test('an older revision that arrives late is reported stale and never overwrites the head', async () => {
  const seller = replica();
  await processBatch({ envelopes: [envelope('e1', 1, 'active'), envelope('e2', 3, 'active')] }, seller.apply);
  const late = await processBatch({ envelopes: [envelope('e9', 2, 'suspended')] }, seller.apply);
  assert.equal(late.stale, 1);
  assert.equal(seller.revisions.get(KEY), 3);
  assert.equal(seller.statuses.get(KEY), 'active');
});

test('a handler failure is isolated: later envelopes in the same batch still apply', async () => {
  const seller = replica({ failEventIds: ['e5'] });
  await processBatch({ envelopes: [envelope('e1', 1, 'active')] }, seller.apply);
  const result = await processBatch(
    { envelopes: [envelope('e5', 2, 'suspended'), envelope('e6', 3, 'suspended')] },
    seller.apply,
  );
  assert.equal(result.failed, 1);
  assert.equal(result.applied, 1);
  assert.equal(seller.revisions.get(KEY), 3);
});

test('a reset admin that restarts at revision 1 is stale against a seller holding a higher head (H-R)', async () => {
  const seller = replica();
  await processBatch({ envelopes: [envelope('e1', 5, 'active')] }, seller.apply);
  const reset = await processBatch({ envelopes: [envelope('e-reset', 1, 'suspended')] }, seller.apply);
  assert.equal(reset.stale, 1);
  assert.equal(seller.revisions.get(KEY), 5);
});

test('the full trace is deterministic: two replicas fed the same history end in the same state', async () => {
  const history = [
    envelope('t1', 1, 'active'),
    envelope('t2', 2, 'suspended'),
    envelope('t3', 2, 'active'),
    envelope('t4', 3, 'suspended'),
  ];
  const first = replica();
  const second = replica();
  await processBatch({ envelopes: history }, first.apply);
  await processBatch({ envelopes: history }, second.apply);
  assert.deepEqual([...first.revisions], [...second.revisions]);
  assert.deepEqual([...first.statuses], [...second.statuses]);
});
