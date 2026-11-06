
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncHeaders } from '@markaz/platform-kit/hmac';

const KEY = 'k-test';
const SECRET = 'x'.repeat(40);
const RECEIVE_URL = 'http://seller.test/api/internal/sync/receive';
const STORE_ID = '65a000000000000000000001';
const EVENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

let POST: (request: Request) => Promise<Response>;

before(async () => {
  const mod = await import('../src/app/api/internal/sync/receive/route');
  POST = mod.POST;
});

function setKeys(): void {
  process.env.SYNC_KEY_ID_CURRENT = KEY;
  process.env.SYNC_SECRET_CURRENT = SECRET;
}

afterEach(() => {
  delete process.env.SYNC_KEY_ID_CURRENT;
  delete process.env.SYNC_SECRET_CURRENT;
  delete process.env.SYNC_KEY_ID_PREVIOUS;
  delete process.env.SYNC_SECRET_PREVIOUS;
});

function signed(body: string, sentBody: string = body): Request {
  const headers = buildSyncHeaders({ keyId: KEY, secret: SECRET, rawBody: body });
  return new Request(RECEIVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: sentBody,
  });
}

function batchBody(overrides: Record<string, unknown> = {}): string {
  const envelope = {
    schemaVersion: 1,
    eventId: EVENT_ID,
    source: 'admin',
    entity: 'store',
    entityId: STORE_ID,
    group: 'governance',
    revision: 2,
    occurredAt: '2026-10-01T00:00:00.000Z',
    op: 'upsert',
    data: { status: 'suspended' },
    dataHash: '0'.repeat(64),
    ...overrides,
  };
  return JSON.stringify({ envelopes: [envelope] });
}

test('the receiver refuses every batch with 503 when no sync keys are configured', async () => {
  const response = await POST(new Request(RECEIVE_URL, { method: 'POST', body: batchBody() }));
  assert.equal(response.status, 503);
});

test('the receiver refuses an unsigned batch with 401', async () => {
  setKeys();
  const response = await POST(new Request(RECEIVE_URL, { method: 'POST', body: batchBody() }));
  assert.equal(response.status, 401);
});

test('a batch changed after signing is refused with 401 before it is parsed', async () => {
  setKeys();
  const response = await POST(signed(batchBody(), batchBody({ revision: 9 })));
  assert.equal(response.status, 401);
});

test('a signed batch with no envelopes is refused with 400 before the database is touched', async () => {
  setKeys();
  const response = await POST(signed(JSON.stringify({ envelopes: [] })));
  assert.equal(response.status, 400);
});

test('a signed envelope whose dataHash does not match its data is refused with 400', async () => {
  setKeys();
  const response = await POST(signed(batchBody()));
  assert.equal(response.status, 400);
});

// Positive path: the receiver applies, replays, and rejects stale revisions.
// The seller connection and the Store model calls are stubbed, so no database is opened.
import mongoose from 'mongoose';
import dbSchemasModule from '@markaz/db-schemas';
const dbSchemas = dbSchemasModule as any;
import { computeDataHash } from '@markaz/platform-kit/hmac';

const POSITIVE_STORE_ID = '65a000000000000000000002';
const ULID_TAILS = ['FAV', 'FAW', 'FAX', 'FAY', 'FAZ'];

type StoreRow = { _id: string; govRevision: number; status: string };

function installSellerDbStubs(store: StoreRow): () => void {
  const model = dbSchemas.Store as any;
  const originals = {
    connect: (mongoose as any).connect,
    findById: model.findById,
    updateOne: model.updateOne,
    exists: model.exists,
  };
  (mongoose as any).connect = async () => mongoose;
  model.findById = (id: string) => ({
    select: () => ({ lean: async () => (String(store._id) === String(id) ? { ...store } : null) }),
  });
  model.exists = async (filter: Record<string, unknown>) =>
    String(store._id) === String(filter._id) ? { _id: store._id } : null;
  model.updateOne = async (filter: Record<string, any>, update: Record<string, any>) => {
    if (String(filter._id) !== String(store._id)) return { matchedCount: 0, modifiedCount: 0 };
    const field = Object.keys(filter).find((key) => key !== '_id') as string;
    const condition = filter[field] as { $lt: number };
    if (!(Number((store as any)[field] ?? 0) < condition.$lt)) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(store, update.$set);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  return () => {
    (mongoose as any).connect = originals.connect;
    model.findById = originals.findById;
    model.updateOne = originals.updateOne;
    model.exists = originals.exists;
  };
}

function positiveEnvelope(tailIndex: number, revision: number, status: string): Record<string, unknown> {
  const data = { status };
  return {
    schemaVersion: 1,
    eventId: '01ARZ3NDEKTSV4RRFFQ69G5' + ULID_TAILS[tailIndex],
    source: 'admin',
    entity: 'store',
    entityId: POSITIVE_STORE_ID,
    group: 'governance',
    revision,
    occurredAt: '2026-10-01T00:00:00.000Z',
    op: 'upsert',
    data,
    dataHash: computeDataHash(data),
  };
}

async function postSigned(envelopes: Array<Record<string, unknown>>): Promise<{ status: number; body: any }> {
  setKeys();
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  const response = await POST(signed(JSON.stringify({ envelopes })));
  return { status: response.status, body: await response.json() };
}

test('positive path: a newer revision is applied and the response is 200 with an applied outcome', async () => {
  const store: StoreRow = { _id: POSITIVE_STORE_ID, govRevision: 1, status: 'active' };
  const restore = installSellerDbStubs(store);
  try {
    const result = await postSigned([positiveEnvelope(0, 2, 'suspended')]);
    assert.equal(result.status, 200);
    assert.equal(result.body.results[0].outcome, 'applied');
    assert.equal(result.body.applied, 1);
    assert.equal(store.govRevision, 2);
  } finally {
    restore();
  }
});

test('positive path: replaying the same revision is reported as duplicate and changes nothing', async () => {
  const store: StoreRow = { _id: POSITIVE_STORE_ID, govRevision: 1, status: 'active' };
  const restore = installSellerDbStubs(store);
  try {
    await postSigned([positiveEnvelope(0, 2, 'suspended')]);
    const replay = await postSigned([positiveEnvelope(0, 2, 'suspended')]);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.results[0].outcome, 'duplicate');
    assert.equal(replay.body.duplicate, 1);
    assert.equal(store.govRevision, 2);
  } finally {
    restore();
  }
});

test('positive path: a lower revision is reported as stale and never overwrites the head', async () => {
  const store: StoreRow = { _id: POSITIVE_STORE_ID, govRevision: 3, status: 'active' };
  const restore = installSellerDbStubs(store);
  try {
    const result = await postSigned([positiveEnvelope(1, 2, 'suspended')]);
    assert.equal(result.status, 200);
    assert.equal(result.body.results[0].outcome, 'stale');
    assert.equal(result.body.stale, 1);
    assert.equal(store.govRevision, 3);
  } finally {
    restore();
  }
});

test('positive path: a mixed batch returns one outcome per envelope in order', async () => {
  const store: StoreRow = { _id: POSITIVE_STORE_ID, govRevision: 1, status: 'active' };
  const restore = installSellerDbStubs(store);
  try {
    const result = await postSigned([positiveEnvelope(2, 3, 'suspended'), positiveEnvelope(3, 2, 'active')]);
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.results.map((item: { outcome: string }) => item.outcome),
      ['applied', 'stale'],
    );
    assert.equal(store.govRevision, 3);
  } finally {
    restore();
  }
});
