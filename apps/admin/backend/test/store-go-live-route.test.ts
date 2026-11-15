import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildSyncHeaders } from '@markaz/platform-kit/hmac';
import { Store } from '@/lib/workspace';

// D-098 A2: the seller backend tells the admin console that a store went live or asked to. Models are stubbed.

const KEY = 'k-test';
const SECRET = 'x'.repeat(40);
const STORE = '65a000000000000000000001';
const AT = '2026-11-15T09:00:00.000Z';
let POST: (request: Request) => Promise<Response>;
const StoreModel = Store as any;

before(async () => {
  process.env.SYNC_KEY_ID_CURRENT = KEY;
  process.env.SYNC_SECRET_CURRENT = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  POST = (await import('../src/app/api/internal/stores/go-live/route')).POST;
});

function signed(body: string): Request {
  const headers = buildSyncHeaders({ keyId: KEY, secret: SECRET, rawBody: body });
  return new Request('http://admin.test/api/internal/stores/go-live', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
}

interface State {
  status: string;
  goLiveRequestedAt: Date | null;
  exists?: boolean;
}

function install(state: State): () => void {
  const saved = { connect: (mongoose as any).connect, updateOne: StoreModel.updateOne, exists: StoreModel.exists };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.updateOne = async (filter: any, update: any) => {
    const match = state.exists !== false && filter.status === state.status && (!('goLiveRequestedAt' in filter) || state.goLiveRequestedAt === null);
    if (match) Object.assign(state, update.$set);
    return { matchedCount: match ? 1 : 0 };
  };
  StoreModel.exists = async () => (state.exists === false ? null : { _id: STORE });
  return () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.updateOne = saved.updateOne;
    StoreModel.exists = saved.exists;
  };
}

test('an unsigned call is refused with 401', async () => {
  const res = await POST(new Request('http://admin.test/x', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 401);
});

test('active moves a pending store to active once; a repeat changes nothing', async () => {
  const state: State = { status: 'pending', goLiveRequestedAt: null };
  const restore = install(state);
  try {
    const body = JSON.stringify({ storeId: STORE, status: 'active', goLiveRequestedAt: AT });
    assert.deepEqual(await (await POST(signed(body))).json(), { changed: true });
    assert.equal(state.status, 'active');
    assert.deepEqual(await (await POST(signed(body))).json(), { changed: false });
  } finally {
    restore();
  }
});

test('pending records the request time once and keeps the store pending', async () => {
  const state: State = { status: 'pending', goLiveRequestedAt: null };
  const restore = install(state);
  try {
    const body = JSON.stringify({ storeId: STORE, status: 'pending', goLiveRequestedAt: AT });
    assert.deepEqual(await (await POST(signed(body))).json(), { changed: true });
    assert.equal(state.status, 'pending');
    assert.ok(state.goLiveRequestedAt instanceof Date);
    assert.deepEqual(await (await POST(signed(body))).json(), { changed: false });
  } finally {
    restore();
  }
});

test('a suspended store is not touched, an unknown store is 404, a bad body is 422', async () => {
  const restore = install({ status: 'suspended', goLiveRequestedAt: null });
  try {
    const body = JSON.stringify({ storeId: STORE, status: 'active', goLiveRequestedAt: AT });
    assert.deepEqual(await (await POST(signed(body))).json(), { changed: false });
    assert.equal((await POST(signed(JSON.stringify({ storeId: 'nope', status: 'active', goLiveRequestedAt: AT })))).status, 422);
  } finally {
    restore();
  }
  const restore2 = install({ status: 'pending', goLiveRequestedAt: null, exists: false });
  try {
    assert.equal((await POST(signed(JSON.stringify({ storeId: STORE, status: 'active', goLiveRequestedAt: AT })))).status, 404);
  } finally {
    restore2();
  }
});
