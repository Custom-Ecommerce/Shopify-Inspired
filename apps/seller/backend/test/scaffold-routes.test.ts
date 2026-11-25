
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

// S7-B5: the two 501 placeholders are real routes now. With no session (and here no session secret) they are refused at the door, never 501
// and never open. The behaviour itself is in domain-routes.test.ts.
test('domain connect is no longer a 501 placeholder: with no session it is refused before anything else', async () => {
  const response = await connect(json({ domain: 'shop.example.com' }), params(STORE));
  assert.notEqual(response.status, 501);
  assert.ok([401, 503].includes(response.status), 'status ' + response.status);
});

test('domain verify is no longer a 501 placeholder: with no session it is refused before anything else', async () => {
  const response = await verify(json({}), params(STORE));
  assert.notEqual(response.status, 501);
  assert.ok([401, 503].includes(response.status), 'status ' + response.status);
});

test('the domain disconnect and state routes exist and are not open either', async () => {
  const disconnect = (await import('../src/app/api/stores/[id]/domain/disconnect/route')).POST;
  const state = (await import('../src/app/api/stores/[id]/domain/route')).GET;
  for (const response of [await disconnect(json({}), params(STORE)), await state(json({}), params(STORE))]) {
    assert.ok([401, 503].includes(response.status), 'status ' + response.status);
  }
});

// Sprint 4 EP-04.US03.T03 (D-088): the Stripe Connect onboarding routes were removed, so their two tests are gone.
test('the Stripe Connect onboarding routes no longer exist (D-088)', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(new URL('../src/app/api/stores/[id]/billing/onboard/route.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/app/api/billing/onboard/route.ts', import.meta.url)), false);
});
