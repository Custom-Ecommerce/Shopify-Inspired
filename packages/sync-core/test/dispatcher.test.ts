
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SyncOutbox } from '@markaz/db-schemas';
import { drainBackoffMs, drainSyncOutbox, DRAIN_MAX_ATTEMPTS } from '../src/dispatcher';

const STORE_ID = '65a000000000000000000001';
const EVENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SELLER_URL = 'http://seller.test';
const ALLOWED_STATUSES = ['sent', 'dead'];

type Doc = Record<string, unknown>;
interface Settle { filter: Doc; set: Doc }
interface Sent { url: string; body: string }

const outboxModel = SyncOutbox as unknown as Doc;
const connection = mongoose.connection as unknown as Doc;
const saved = {
  collection: connection.collection,
  find: outboxModel.find,
  updateOne: outboxModel.updateOne,
  fetch: globalThis.fetch,
};

let collections: Record<string, Doc[]> = {};
let outboxRows: Doc[] = [];
let claimModified = 1;
let claimCount = 0;
let settles: Settle[] = [];
let requests: Sent[] = [];
let digestResponse: () => Response = () => json({ revisions: {} }, 200);
let receiveResponse: () => Response = () => json({ results: [{ eventId: EVENT_ID, outcome: 'applied' }] }, 200);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected !== null && typeof expected === 'object' && !(expected instanceof mongoose.Types.ObjectId)) return true;
    return String(doc[key]) === String(expected);
  });
}

function installStubs(): void {
  connection.collection = (name: string) => ({
    findOne: async (filter: Doc) => (collections[name] ?? []).find((doc) => matches(doc, filter)) ?? null,
    updateOne: async () => ({ modifiedCount: 1 }),
  });
  outboxModel.find = () => {
    const chain: Doc = {
      sort: () => chain,
      limit: () => chain,
      lean: () => chain,
      exec: async () => outboxRows,
    };
    return chain;
  };
  outboxModel.updateOne = async (filter: Doc, update: Doc) => {
    if (update.$inc) {
      claimCount += 1;
      return { modifiedCount: claimModified };
    }
    settles.push({ filter, set: (update.$set ?? {}) as Doc });
    return { modifiedCount: 1 };
  };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
    if (url.endsWith('/api/internal/sync/digest')) return digestResponse();
    if (url.endsWith('/api/internal/sync/receive')) return receiveResponse();
    throw new Error('unexpected request to ' + url);
  }) as typeof fetch;
}

function restoreStubs(): void {
  connection.collection = saved.collection;
  outboxModel.find = saved.find;
  outboxModel.updateOne = saved.updateOne;
  globalThis.fetch = saved.fetch;
}

function storeDoc(overrides: Doc = {}): Doc {
  return {
    _id: new mongoose.Types.ObjectId(STORE_ID),
    name: 'Acme',
    slug: 'acme',
    govRevision: 3,
    opsRevision: 0,
    owner: null,
    ...overrides,
  };
}

function outboxRow(overrides: Doc = {}): Doc {
  return {
    _id: new mongoose.Types.ObjectId(),
    eventId: EVENT_ID,
    target: 'seller',
    entity: 'store',
    entityId: STORE_ID,
    group: 'governance',
    revision: 3,
    attempts: 0,
    status: 'pending',
    ...overrides,
  };
}

function resetState(): void {
  collections = { stores: [storeDoc()], sellers: [], globals: [] };
  outboxRows = [outboxRow()];
  claimModified = 1;
  claimCount = 0;
  settles = [];
  requests = [];
  digestResponse = () => json({ revisions: {} }, 200);
  receiveResponse = () => json({ results: [{ eventId: EVENT_ID, outcome: 'applied' }] }, 200);
}

function receiveRequests(): Sent[] {
  return requests.filter((req) => req.url.endsWith('/api/internal/sync/receive'));
}

function assertOnlyPayloadStatuses(): void {
  for (const settle of settles) {
    if ('status' in settle.set) {
      assert.ok(ALLOWED_STATUSES.includes(String(settle.set.status)), 'unexpected status ' + String(settle.set.status));
    }
  }
}

beforeEach(() => {
  process.env.SELLER_BACKEND_API_URL = SELLER_URL;
  process.env.SYNC_KEY_ID_CURRENT = 'k-test';
  process.env.SYNC_SECRET_CURRENT = 'x'.repeat(40);
  installStubs();
  resetState();
});

afterEach(() => {
  restoreStubs();
  delete process.env.SELLER_BACKEND_API_URL;
  delete process.env.SYNC_KEY_ID_CURRENT;
  delete process.env.SYNC_SECRET_CURRENT;
});

test('backoff follows the legacy schedule and caps at six hours', () => {
  assert.equal(drainBackoffMs(1), 5000);
  assert.equal(drainBackoffMs(2), 30000);
  assert.equal(drainBackoffMs(6), 21600000);
  assert.equal(drainBackoffMs(40), 21600000);
});

test('a row claimed by another drain is skipped and never delivered', async () => {
  claimModified = 0;
  const summary = await drainSyncOutbox();
  assert.equal(summary.configured, true);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.sent, 0);
  assert.equal(receiveRequests().length, 0);
});

test('an owner with no sellers mirror is retried, not sent with an admin id', async () => {
  collections.stores = [storeDoc({ owner: new mongoose.Types.ObjectId() })];
  collections.sellers = [];
  const summary = await drainSyncOutbox();
  assert.equal(summary.retry, 1);
  assert.equal(receiveRequests().length, 0);
  assert.equal(settles.length, 1);
  assert.equal(settles[0].set.status, undefined);
  assert.match(String(settles[0].set.lastError), /OWNER_TRANSLATION_PENDING/);
  assertOnlyPayloadStatuses();
});

test('H-R: a revision below the seller acknowledged revision is dead-lettered, never published', async () => {
  digestResponse = () => json({ revisions: { ['store|' + STORE_ID + '|governance']: 5 } }, 200);
  const summary = await drainSyncOutbox();
  assert.equal(summary.dead, 1);
  assert.equal(receiveRequests().length, 0);
  assert.equal(settles[0].set.status, 'dead');
  assert.match(String(settles[0].set.lastError), /STALE_REVISION/);
  assertOnlyPayloadStatuses();
});

test('when the digest is unreachable nothing is claimed or published', async () => {
  digestResponse = () => new Response('unavailable', { status: 503 });
  const summary = await drainSyncOutbox();
  assert.equal(summary.retry, 1);
  assert.equal(claimCount, 0);
  assert.equal(receiveRequests().length, 0);
});

test('a delivered row is sent as a one-envelope batch and marked sent', async () => {
  const summary = await drainSyncOutbox();
  assert.equal(summary.sent, 1);
  const sent = receiveRequests();
  assert.equal(sent.length, 1);
  const batch = JSON.parse(sent[0].body) as { envelopes: Array<Record<string, unknown>> };
  assert.equal(batch.envelopes.length, 1);
  assert.equal(batch.envelopes[0].entity, 'store');
  assert.equal(batch.envelopes[0].revision, 3);
  assert.equal(settles[0].set.status, 'sent');
  assert.ok(settles[0].set.sentAt instanceof Date);
  assertOnlyPayloadStatuses();
});

test('a receiver rejection with a permanent status dead-letters the row', async () => {
  receiveResponse = () => new Response('invalid', { status: 422 });
  const summary = await drainSyncOutbox();
  assert.equal(summary.dead, 1);
  assert.equal(settles[0].set.status, 'dead');
  assertOnlyPayloadStatuses();
});

test('a transient receiver failure keeps the row pending with a backoff time', async () => {
  receiveResponse = () => new Response('busy', { status: 503 });
  const summary = await drainSyncOutbox();
  assert.equal(summary.retry, 1);
  assert.equal(settles[0].set.status, undefined);
  assert.ok(settles[0].set.nextAttemptAt instanceof Date);
  assertOnlyPayloadStatuses();
});

test('a receiver that marks the envelope rejected dead-letters it even on HTTP 200', async () => {
  receiveResponse = () => json({ results: [{ eventId: EVENT_ID, outcome: 'rejected', reason: 'bad hash' }] }, 200);
  const summary = await drainSyncOutbox();
  assert.equal(summary.dead, 1);
  assert.equal(settles[0].set.status, 'dead');
});

test('a row that exhausts its attempts is dead-lettered', async () => {
  outboxRows = [outboxRow({ attempts: DRAIN_MAX_ATTEMPTS - 1 })];
  receiveResponse = () => new Response('busy', { status: 503 });
  const summary = await drainSyncOutbox();
  assert.equal(summary.dead, 1);
  assert.equal(settles[0].set.status, 'dead');
});
