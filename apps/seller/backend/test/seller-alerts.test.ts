import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { SellerAlert, Store, assertCan, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

// EP-07.US03.T01: the alert routes. Models are stubbed; no database. Seller B must never read or change Seller A's alerts.

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const ALERT_A1 = '65a0000000000000000e0001';
const ALERT_A2 = '65a0000000000000000e0002';
const ALERT_B1 = '65a0000000000000000e0003';

const AlertModel = SellerAlert as any;
const StoreModel = Store as any;

const stores = [
  { _id: STORE_A, owner: USER_A, createdAt: new Date('2026-01-01') },
  { _id: STORE_B, owner: USER_B, createdAt: new Date('2026-01-02') },
];

let alerts: Array<Record<string, any>> = [];
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let listGET: (r: NextRequest) => Promise<Response>;
let unreadGET: (r: NextRequest) => Promise<Response>;
let readPOST: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let readAllPOST: (r: NextRequest) => Promise<Response>;
let restore: () => void = () => {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  listGET = (await import('../src/app/api/alerts/route')).GET;
  unreadGET = (await import('../src/app/api/alerts/unread-count/route')).GET;
  readPOST = (await import('../src/app/api/alerts/[id]/read/route')).POST;
  readAllPOST = (await import('../src/app/api/alerts/read-all/route')).POST;
});

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => (value === null ? row[key] === null || row[key] === undefined : String(row[key]) === String(value)));
}

function query(rows: () => unknown[], single = false) {
  const q: any = { sort: () => q, skip: () => q, limit: () => q, select: () => q, lean: async () => (single ? rows()[0] ?? null : rows()) };
  return q;
}

beforeEach(() => {
  const saved = Object.fromEntries(['find', 'countDocuments', 'findOne', 'findOneAndUpdate', 'updateMany'].map((m) => [m, AlertModel[m]]));
  const savedStore = { findOne: StoreModel.findOne, exists: StoreModel.exists };
  const savedConnect = (mongoose as any).connect;
  alerts = [
    { _id: ALERT_A1, store: STORE_A, kind: 'new_order', title: 'New order ORD-AAAA2222', body: 'Ayesha', link: '/orders/x', readAt: null, createdAt: new Date('2026-11-14T08:00:00Z') },
    { _id: ALERT_A2, store: STORE_A, kind: 'low_stock', title: 'Only 3 left of Shirt', body: '', link: '/inventory', readAt: null, createdAt: new Date('2026-11-14T09:00:00Z') },
    { _id: ALERT_B1, store: STORE_B, kind: 'new_order', title: 'Secret order of store B', body: 'Bilal', link: '/orders/y', readAt: null, createdAt: new Date('2026-11-14T10:00:00Z') },
  ];
  (mongoose as any).connect = async () => mongoose;
  AlertModel.find = (filter: any) => query(() => alerts.filter((a) => matches(a, filter)).sort((x, y) => y.createdAt - x.createdAt));
  AlertModel.countDocuments = async (filter: any) => alerts.filter((a) => matches(a, filter)).length;
  AlertModel.findOne = (filter: any) => query(() => alerts.filter((a) => matches(a, filter)), true);
  AlertModel.findOneAndUpdate = (filter: any, update: any) =>
    query(() => {
      const row = alerts.find((a) => matches(a, filter));
      if (!row) return [];
      Object.assign(row, update.$set);
      return [{ ...row }];
    }, true);
  AlertModel.updateMany = async (filter: any, update: any) => {
    const hit = alerts.filter((a) => matches(a, filter));
    for (const row of hit) Object.assign(row, update.$set);
    return { modifiedCount: hit.length };
  };
  StoreModel.findOne = (filter: any) => query(() => stores.filter((s) => matches(s, filter)), true);
  StoreModel.exists = async (filter: any) => (stores.some((s) => matches(s, filter)) ? { _id: filter._id } : null);
  restore = () => {
    for (const [m, fn] of Object.entries(saved)) AlertModel[m] = fn;
    StoreModel.findOne = savedStore.findOne;
    StoreModel.exists = savedStore.exists;
    (mongoose as any).connect = savedConnect;
  };
});

afterEach(() => restore());

function req(url: string, token: string, method = 'GET', store?: string): NextRequest {
  const headers: Record<string, string> = { authorization: 'Bearer ' + token };
  if (store) headers['x-store-id'] = store;
  return new NextRequest('http://seller.test' + url, { method, headers });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

test('alerts need a session', async () => {
  assert.equal((await listGET(new NextRequest('http://seller.test/api/alerts'))).status, 401);
});

test("the list holds only the seller's own store, newest first, with the unread count", async () => {
  const response = await listGET(req('/api/alerts', tokenA, 'GET', STORE_A));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { docs: Array<{ id: string; title: string }>; totalDocs: number; unread: number };
  assert.deepEqual(body.docs.map((d) => d.id), [ALERT_A2, ALERT_A1]);
  assert.equal(body.totalDocs, 2);
  assert.equal(body.unread, 2);
  assert.equal(JSON.stringify(body).includes('Secret order of store B'), false);
  assert.equal('store' in (body.docs[0] as Record<string, unknown>), false, 'no store id on the wire');
});

test("Seller B naming Seller A's store is refused on every alert route, and nothing changes", async () => {
  assert.equal((await listGET(req('/api/alerts', tokenB, 'GET', STORE_A))).status, 403);
  assert.equal((await unreadGET(req('/api/alerts/unread-count', tokenB, 'GET', STORE_A))).status, 403);
  assert.equal((await readPOST(req('/api/alerts/' + ALERT_A1 + '/read', tokenB, 'POST', STORE_A), params(ALERT_A1))).status, 403);
  assert.equal((await readAllPOST(req('/api/alerts/read-all', tokenB, 'POST', STORE_A))).status, 403);
  assert.ok(alerts.filter((a) => a.store === STORE_A).every((a) => a.readAt === null));
});

test("Seller B marking Seller A's alert through their own store gets 404, and the alert stays unread", async () => {
  const response = await readPOST(req('/api/alerts/' + ALERT_A1 + '/read', tokenB, 'POST', STORE_B), params(ALERT_A1));
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes('ORD-AAAA2222'), false);
  assert.equal(alerts.find((a) => a._id === ALERT_A1)!.readAt, null);
});

test('an admin session has no alert access (seller only, as orders)', async () => {
  assert.equal((await listGET(req('/api/alerts', tokenAdmin, 'GET', STORE_A))).status, 403);
  assert.equal((await readAllPOST(req('/api/alerts/read-all', tokenAdmin, 'POST', STORE_A))).status, 403);
  assert.throws(() => assertCan('seller', 'update', 'sellerAlerts', ['title']));
  assert.throws(() => assertCan('seller', 'create', 'sellerAlerts'));
  assert.throws(() => assertCan('seller', 'delete', 'sellerAlerts'));
});

test('marking one read lowers the count; marking it again changes nothing', async () => {
  const first = await readPOST(req('/api/alerts/' + ALERT_A1 + '/read', tokenA, 'POST', STORE_A), params(ALERT_A1));
  assert.equal(first.status, 200);
  const body = (await first.json()) as { alert: { id: string; readAt: string | null }; unread: number };
  assert.equal(body.alert.id, ALERT_A1);
  assert.ok(body.alert.readAt);
  assert.equal(body.unread, 1);
  const readAt = alerts.find((a) => a._id === ALERT_A1)!.readAt;

  const again = await readPOST(req('/api/alerts/' + ALERT_A1 + '/read', tokenA, 'POST', STORE_A), params(ALERT_A1));
  assert.equal(again.status, 200);
  assert.equal(alerts.find((a) => a._id === ALERT_A1)!.readAt, readAt, 'the first read time is kept');
  assert.equal((await readPOST(req('/api/alerts/not-an-id/read', tokenA, 'POST', STORE_A), params('not-an-id'))).status, 404);
});

test("mark all read touches only the seller's store", async () => {
  const response = await readAllPOST(req('/api/alerts/read-all', tokenA, 'POST', STORE_A));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { marked: 2, unread: 0 });
  assert.equal(alerts.find((a) => a._id === ALERT_B1)!.readAt, null);
  const count = await unreadGET(req('/api/alerts/unread-count', tokenB, 'GET', STORE_B));
  assert.deepEqual(await count.json(), { unread: 1 });
});
