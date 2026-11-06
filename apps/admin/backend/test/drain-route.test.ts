
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let GET: (request: Request) => Promise<Response>;
let POST: (request: Request) => Promise<Response>;
const DRAIN_URL = 'http://admin.test/api/internal/sync/drain';

before(async () => {
  process.env.CRON_SECRET = 'cron-secret-for-tests';
  const route = await import('../src/app/api/internal/sync/drain/route');
  GET = route.GET;
  POST = route.POST;
});

test('the drain route refuses a request without the bearer secret', async () => {
  const response = await GET(new Request(DRAIN_URL));
  assert.equal(response.status, 401);
});

test('the drain route refuses a wrong bearer secret on both verbs', async () => {
  const headers = { authorization: 'Bearer wrong-secret' };
  assert.equal((await GET(new Request(DRAIN_URL, { headers }))).status, 401);
  assert.equal((await POST(new Request(DRAIN_URL, { method: 'POST', headers }))).status, 401);
});
