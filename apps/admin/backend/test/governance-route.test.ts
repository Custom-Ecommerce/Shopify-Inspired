import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildSyncHeaders } from '@markaz/platform-kit/hmac';
import { Store, registerSyncOutboxModel } from '@/lib/workspace';

const KEY = 'k-test';
const SECRET = 'x'.repeat(40);
const STORE = '65a000000000000000000001';
const URL_UNDER_TEST = 'http://admin.test/api/internal/governance/update';

const outboxRows: Array<Record<string, any>> = [];
const storeUpdates: Array<{ filter: any; update: any }> = [];
let storeMatched = 1;
let POST: (request: Request) => Promise<Response>;

/** A chainable query: sort and lean return the query, and exec resolves to the value. */
function chain(value: unknown): any {
  const c: any = { sort: () => c, lean: () => c, exec: async () => value };
  return c;
}

/** A minimal outbox port: the enqueue path only writes, and reads nothing it can't answer. */
const fakeOutbox = {
  create: async (doc: Record<string, any>) => {
    outboxRows.push(doc);
    return doc;
  },
  find: () => chain([]),
  findOne: () => chain(null),
  updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
  updateMany: async () => ({ matchedCount: 0, modifiedCount: 0 }),
};

const StoreModel = Store as any;

before(async () => {
  process.env.SYNC_KEY_ID_CURRENT = KEY;
  process.env.SYNC_SECRET_CURRENT = SECRET;
  delete process.env.SYNC_KEY_ID_PREVIOUS;
  delete process.env.SYNC_SECRET_PREVIOUS;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  POST = (await import('../src/app/api/internal/governance/update/route')).POST;
});

function signed(body: string, sentBody: string = body): Request {
  const headers = buildSyncHeaders({ keyId: KEY, secret: SECRET, rawBody: body });
  return new Request(URL_UNDER_TEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: sentBody,
  });
}

/** Stubs the connection and Store.updateOne; registers the fake outbox so the enqueue path is in-process. */
function install(matched: number): () => void {
  const originals = { connect: (mongoose as any).connect, updateOne: StoreModel.updateOne };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.updateOne = async (filter: any, update: any) => {
    storeUpdates.push({ filter, update });
    return { matchedCount: matched, modifiedCount: matched };
  };
  registerSyncOutboxModel(fakeOutbox as any);
  storeMatched = matched;
  outboxRows.length = 0;
  storeUpdates.length = 0;
  return () => {
    (mongoose as any).connect = originals.connect;
    StoreModel.updateOne = originals.updateOne;
  };
}

test('an unsigned governance update is refused with 401', async () => {
  const restore = install(1);
  try {
    const response = await POST(new Request(URL_UNDER_TEST, { method: 'POST', body: '{}' }));
    assert.equal(response.status, 401);
    assert.equal(outboxRows.length, 0);
  } finally {
    restore();
  }
});

test('a signed update with an unknown status is refused with 422 and changes nothing', async () => {
  const restore = install(1);
  try {
    const body = JSON.stringify({ storeId: STORE, status: 'deleted' });
    const response = await POST(signed(body));
    assert.equal(response.status, 422);
    assert.equal(storeUpdates.length, 0);
    assert.equal(outboxRows.length, 0);
  } finally {
    restore();
  }
});

test('a signed suspension of an existing store is applied and queued for the seller', async () => {
  const restore = install(1);
  try {
    const body = JSON.stringify({ storeId: STORE, status: 'suspended' });
    const response = await POST(signed(body));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { queued: unknown };
    assert.ok(payload.queued !== undefined);
    assert.deepEqual(storeUpdates[0].update, { $set: { status: 'suspended' }, $inc: { govRevision: 1 } });
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].target, 'seller');
    assert.equal(outboxRows[0].group, 'governance');
    assert.equal(outboxRows[0].entityId, STORE);
  } finally {
    restore();
  }
});

test('a signed update for a store that does not exist answers 404 and queues nothing', async () => {
  const restore = install(0);
  try {
    const body = JSON.stringify({ storeId: STORE, status: 'active' });
    const response = await POST(signed(body));
    assert.equal(response.status, 404);
    assert.equal(outboxRows.length, 0);
  } finally {
    restore();
  }
});

test('the body that was signed is the body that is applied: a changed body is refused with 401', async () => {
  const restore = install(1);
  try {
    const signedBody = JSON.stringify({ storeId: STORE, status: 'active' });
    const sentBody = JSON.stringify({ storeId: STORE, status: 'suspended' });
    const response = await POST(signed(signedBody, sentBody));
    assert.equal(response.status, 401);
    assert.equal(storeUpdates.length, 0);
  } finally {
    restore();
  }
});
