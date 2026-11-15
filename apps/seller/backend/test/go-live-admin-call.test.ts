import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendGoLiveToAdmin, ADMIN_GO_LIVE_PATH } from '../src/lib/admin-go-live';

// D-098 A2: the signed seller -> admin call. fetch is stubbed; no network.

const REPORT = { storeId: '65a000000000000000000011', status: 'active' as const, goLiveRequestedAt: '2026-11-15T09:00:00.000Z' };
let calls: Array<{ url: string; body: any; headers: Record<string, string> }>;
let original: typeof fetch;
const quiet = { warn: console.warn, error: console.error };

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
  process.env.ADMIN_BACKEND_API_URL = 'http://admin.test/';
  process.env.SYNC_KEY_ID_CURRENT = 'k-test';
  process.env.SYNC_SECRET_CURRENT = 'y'.repeat(40);
  console.warn = () => {};
  console.error = () => {};
});

afterEach(() => {
  globalThis.fetch = original;
  delete process.env.ADMIN_BACKEND_API_URL;
  delete process.env.SYNC_KEY_ID_CURRENT;
  delete process.env.SYNC_SECRET_CURRENT;
  console.warn = quiet.warn;
  console.error = quiet.error;
});

test('one signed POST is made to the admin go-live route', async () => {
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return new Response('{"changed":true}', { status: 200 });
  }) as typeof fetch;
  assert.equal(await sendGoLiveToAdmin(REPORT), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'http://admin.test' + ADMIN_GO_LIVE_PATH);
  assert.deepEqual(calls[0]!.body, REPORT);
  assert.ok(calls[0]!.headers['x-sync-signature']);
  assert.ok(!JSON.stringify(calls[0]!.headers).includes('y'.repeat(40)), 'the secret is never sent');
});

test('a refusal or a network failure answers false and never throws', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  assert.equal(await sendGoLiveToAdmin(REPORT), false);
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  assert.equal(await sendGoLiveToAdmin(REPORT), false);
});

test('without configuration no call is made', async () => {
  delete process.env.ADMIN_BACKEND_API_URL;
  globalThis.fetch = (async () => {
    calls.push({ url: '', body: null, headers: {} });
    return new Response('{}');
  }) as typeof fetch;
  assert.equal(await sendGoLiveToAdmin(REPORT), false);
  assert.equal(calls.length, 0);
});
