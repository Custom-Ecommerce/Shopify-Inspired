import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { INTERNAL_SIGNATURE_MAX_AGE_MS, internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { readSignedRequest } from '@/lib/internal-signature';

const SECRET = 'm'.repeat(40);
const PATH = '/api/internal/moderation/takedown';
const BODY = JSON.stringify({ productId: '65a000000000000000000011', reason: 'Counterfeit goods' });

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.MODERATION_API_SECRET;
  process.env.MODERATION_API_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.MODERATION_API_SECRET;
  else process.env.MODERATION_API_SECRET = saved;
});

interface Options {
  method?: 'GET' | 'POST';
  signedPath?: string;
  sentPath?: string;
  signedBody?: string;
  sentBody?: string;
  secret?: string;
  now?: number;
  headers?: Record<string, string | null>;
}

function request(options: Options = {}): NextRequest {
  const method = options.method ?? 'POST';
  const signed = internalRequestHeaders(
    options.secret ?? SECRET,
    { method, path: options.signedPath ?? PATH, adminId: 'admin-1', body: options.signedBody ?? (method === 'GET' ? '' : BODY) },
    options.now,
  );
  const headers: Record<string, string> = { ...signed };
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  return new NextRequest('http://seller.test' + (options.sentPath ?? options.signedPath ?? PATH), {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: options.sentBody ?? BODY }),
  });
}

async function statusOf(req: NextRequest): Promise<number | 'ok'> {
  const result = await readSignedRequest(req);
  return result.ok ? 'ok' : result.response.status;
}

test('a valid request passes and hands back the body and the operator', async () => {
  const result = await readSignedRequest(request());
  assert.ok(result.ok);
  assert.equal(result.rawBody, BODY);
  assert.equal(result.adminId, 'admin-1');
});

test('a GET signs its query too', async () => {
  const path = '/api/internal/moderation/products?page=2&status=live';
  assert.equal(await statusOf(request({ method: 'GET', signedPath: path })), 'ok');
  assert.equal(await statusOf(request({ method: 'GET', signedPath: path, sentPath: '/api/internal/moderation/products?page=2&status=trash' })), 401);
});

test('a tampered body is refused', async () => {
  assert.equal(await statusOf(request({ sentBody: BODY.replace('Counterfeit', 'Fine') })), 401);
});

test('a tampered path is refused', async () => {
  assert.equal(await statusOf(request({ sentPath: '/api/internal/moderation/restore' })), 401);
});

test('another method on the same path is refused', async () => {
  const signed = internalRequestHeaders(SECRET, { method: 'GET', path: PATH, adminId: 'admin-1', body: BODY });
  assert.equal(await statusOf(new NextRequest('http://seller.test' + PATH, { method: 'POST', headers: signed, body: BODY })), 401);
});

test('a timestamp older than 5 minutes is refused, and so is one far ahead', async () => {
  const now = Date.now();
  assert.equal(await statusOf(request({ now: now - INTERNAL_SIGNATURE_MAX_AGE_MS + 5000 })), 'ok');
  assert.equal(await statusOf(request({ now: now - INTERNAL_SIGNATURE_MAX_AGE_MS - 5000 })), 401);
  assert.equal(await statusOf(request({ now: now + INTERNAL_SIGNATURE_MAX_AGE_MS + 5000 })), 401);
});

test('a changed timestamp breaks the signature, so an old request cannot be refreshed', async () => {
  const signed = internalRequestHeaders(SECRET, { method: 'POST', path: PATH, adminId: 'admin-1', body: BODY }, Date.now() - 1000);
  assert.equal(await statusOf(request({ headers: { 'x-markaz-signature': signed['x-markaz-signature'] ?? '' } })), 401);
});

test('the wrong secret is refused', async () => {
  assert.equal(await statusOf(request({ secret: 'z'.repeat(40) })), 401);
});

test('the operator is signed: another name on a captured request is refused', async () => {
  assert.equal(await statusOf(request({ headers: { 'x-admin-id': 'admin-2' } })), 401);
});

test('a missing header is refused, each one', async () => {
  for (const header of ['x-markaz-signature', 'x-markaz-timestamp', 'x-admin-id']) {
    assert.equal(await statusOf(request({ headers: { [header]: null } })), 401, header);
  }
});

test('junk in the headers is a 401, never an error', async () => {
  assert.equal(await statusOf(request({ headers: { 'x-markaz-signature': 'not-hex' } })), 401);
  assert.equal(await statusOf(request({ headers: { 'x-markaz-timestamp': 'yesterday' } })), 401);
  assert.equal(await statusOf(request({ headers: { 'x-admin-id': 'x'.repeat(65) } })), 401);
});

test('a refusal says nothing about why', async () => {
  const results = [await readSignedRequest(request({ secret: 'z'.repeat(40) })), await readSignedRequest(request({ headers: { 'x-admin-id': null } }))];
  const bodies = await Promise.all(results.map((result) => (result.ok ? '' : result.response.text())));
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[0], JSON.stringify({ errors: [{ message: 'Unauthorized' }] }));
});

test('a short or missing secret closes the route with a 503', async () => {
  process.env.MODERATION_API_SECRET = 'short';
  assert.equal(await statusOf(request({ secret: 'short' })), 503);
  delete process.env.MODERATION_API_SECRET;
  assert.equal(await statusOf(request()), 503);
});
