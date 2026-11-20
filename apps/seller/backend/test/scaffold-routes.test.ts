
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const STORE = '65a000000000000000000001';

type Ctx = { params: Promise<{ id: string }> };
let signup: (request: Request) => Promise<Response>;
let login: (request: Request) => Promise<Response>;
let connect: (request: Request, ctx: Ctx) => Promise<Response>;
let verify: (request: Request, ctx: Ctx) => Promise<Response>;

before(async () => {
  delete process.env.SELLER_AUTH_SECRET;
  delete process.env.SELLER_MONGODB_URI;
  signup = (await import('../src/app/api/signup/route')).POST;
  login = (await import('../src/app/api/users/login/route')).POST;
  connect = (await import('../src/app/api/stores/[id]/domain/connect/route')).POST;
  verify = (await import('../src/app/api/stores/[id]/domain/verify/route')).POST;
});

function json(body: unknown): Request {
  return new Request('http://seller.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string): Ctx {
  return { params: Promise.resolve({ id }) };
}

test('signup refuses a short password with 422 and names the field', async () => {
  const response = await signup(json({ name: 'Ali', email: 'ali@example.com', password: 'short' }));
  assert.equal(response.status, 422);
  const body = (await response.json()) as { issues: Array<{ path: string }> };
  assert.ok(body.issues.some((issue) => issue.path === 'password'));
});

test('signup with a valid body but no session secret is refused with 503, before any database work', async () => {
  const response = await signup(json({ name: 'Ali', email: 'ali@example.com', password: 'longenough' }));
  assert.equal(response.status, 503);
});

test('login refuses a malformed email with 422', async () => {
  const response = await login(json({ email: 'nope', password: 'x' }));
  assert.equal(response.status, 422);
});

test('login with a valid body but no database is refused with 503', async () => {
  const response = await login(json({ email: 'ali@example.com', password: 'x' }));
  assert.equal(response.status, 503);
});

test('domain connect is still 501 until the Vercel integration decision (ID-20)', async () => {
  const response = await connect(json({ domain: 'shop.example.com' }), params(STORE));
  assert.equal(response.status, 501);
});

test('domain verify is still 501 until the Vercel integration decision (ID-20)', async () => {
  const response = await verify(json({}), params(STORE));
  assert.equal(response.status, 501);
});

// Sprint 4 EP-04.US03.T03 (D-088): the Stripe Connect onboarding routes were removed, so their two tests are gone.
test('the Stripe Connect onboarding routes no longer exist (D-088)', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(new URL('../src/app/api/stores/[id]/billing/onboard/route.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/app/api/billing/onboard/route.ts', import.meta.url)), false);
});
