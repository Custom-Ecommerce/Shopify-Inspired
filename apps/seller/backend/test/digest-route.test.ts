
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncHeaders } from '@markaz/platform-kit/hmac';

let POST: (request: Request) => Promise<Response>;
const KEY = 'k-test';
const SECRET = 'x'.repeat(40);
const DIGEST_URL = 'http://seller.test/api/internal/sync/digest';

before(async () => {
  const mod = await import('../src/app/api/internal/sync/digest/route');
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

test('digest refuses every call with 503 when no sync keys are configured', async () => {
  const response = await POST(new Request(DIGEST_URL, { method: 'POST', body: '{}' }));
  assert.equal(response.status, 503);
});

test('digest refuses an unsigned request with 401', async () => {
  setKeys();
  const response = await POST(new Request(DIGEST_URL, { method: 'POST', body: '{}' }));
  assert.equal(response.status, 401);
});

test('digest rejects a signed but malformed body before touching the database', async () => {
  setKeys();
  const body = JSON.stringify({ items: 'not-a-list' });
  const headers = buildSyncHeaders({ keyId: KEY, secret: SECRET, rawBody: body });
  const response = await POST(
    new Request(DIGEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }),
  );
  assert.equal(response.status, 422);
});
