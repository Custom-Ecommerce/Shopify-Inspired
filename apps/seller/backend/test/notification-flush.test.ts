import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { NotificationOutbox } from '@/lib/services';

// EP-07.US01.T02: GET/POST /api/internal/notifications/flush. The outbox model is stubbed; no database, no email.

const SECRET = 'c'.repeat(40);
const OutboxModel = NotificationOutbox as any;

let flushGET: (request: NextRequest) => Promise<Response>;
let flushPOST: (request: NextRequest) => Promise<Response>;
let restore: () => void = () => {};
let finds = 0;
let due: Array<Record<string, any>> = [];

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  const mod = await import('../src/app/api/internal/notifications/flush/route');
  flushGET = mod.GET;
  flushPOST = mod.POST;
});

beforeEach(() => {
  const saved = { connect: (mongoose as any).connect, find: OutboxModel.find, findOneAndUpdate: OutboxModel.findOneAndUpdate, provider: process.env.EMAIL_PROVIDER };
  finds = 0;
  due = [];
  delete process.env.EMAIL_PROVIDER;
  (mongoose as any).connect = async () => mongoose;
  OutboxModel.find = () => {
    finds += 1;
    const q: any = { sort: () => q, limit: () => q, lean: async () => due.map((row) => ({ ...row })) };
    return q;
  };
  OutboxModel.findOneAndUpdate = (filter: any, update: any) => ({
    lean: async () => {
      const row = due.find((r) => String(r._id) === String(filter._id));
      if (!row) return null;
      if (update.$inc) row.attempts += update.$inc.attempts;
      Object.assign(row, update.$set ?? {});
      return { ...row };
    },
  });
  restore = () => {
    (mongoose as any).connect = saved.connect;
    OutboxModel.find = saved.find;
    OutboxModel.findOneAndUpdate = saved.findOneAndUpdate;
    if (saved.provider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = saved.provider;
    delete process.env.OUTBOX_CRON_SECRET;
  };
});

afterEach(() => restore());

const call = (headers: Record<string, string> = {}, method = 'POST') =>
  new NextRequest('http://seller.test/api/internal/notifications/flush', { method, headers });

test('the flush is closed when OUTBOX_CRON_SECRET is not set, whatever is sent', async () => {
  delete process.env.OUTBOX_CRON_SECRET;
  assert.equal((await flushPOST(call({ 'x-cron-secret': 'anything-at-all-long-enough' }))).status, 401);
  assert.equal((await flushPOST(call())).status, 401);
  assert.equal(finds, 0, 'nothing is read');
});

test('a wrong or missing secret is refused with 401 and reads nothing', async () => {
  process.env.OUTBOX_CRON_SECRET = SECRET;
  assert.equal((await flushPOST(call())).status, 401);
  assert.equal((await flushPOST(call({ 'x-cron-secret': SECRET + 'x' }))).status, 401);
  assert.equal((await flushGET(call({ authorization: 'Bearer nope' }, 'GET'))).status, 401);
  assert.equal(finds, 0);
});

test('the right secret runs the flush, by header or bearer, on GET and POST', async () => {
  process.env.OUTBOX_CRON_SECRET = SECRET;
  const viaHeader = await flushPOST(call({ 'x-cron-secret': SECRET }));
  assert.equal(viaHeader.status, 200);
  assert.deepEqual(await viaHeader.json(), { picked: 0, sent: 0, skipped: 0, retry: 0, failed: 0, notClaimed: 0, errors: 0 });
  const viaBearer = await flushGET(call({ authorization: 'Bearer ' + SECRET }, 'GET'));
  assert.equal(viaBearer.status, 200);
  assert.equal(viaBearer.headers.get('cache-control'), 'no-store');
  assert.equal(finds, 2);
});

test('a due row is sent through the configured provider (log in development: skipped)', async () => {
  process.env.OUTBOX_CRON_SECRET = SECRET;
  due = [{ _id: '65a0000000000000000f0001', to: 'a@example.com', subject: 'S', bodyText: 'T', bodyHtml: '<p>T</p>', template: 'order_confirmed', status: 'queued', attempts: 0, nextAttemptAt: new Date(0) }];
  const response = await flushPOST(call({ 'x-cron-secret': SECRET }));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { picked: number; skipped: number };
  assert.equal(body.picked, 1);
  assert.equal(body.skipped, 1);
  assert.equal(due[0]!.status, 'skipped');
  assert.equal(due[0]!.attempts, 1);
});
