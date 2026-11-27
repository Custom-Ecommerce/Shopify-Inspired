import { createApiClient, buildUrl } from '../src/core/api-client';
import { resolveApiUrl } from '../src/core/api-url';
import { ApiError, NetworkError, UpgradeRequired } from '../src/core/errors';
import { createIdempotencyKeyFactory } from '../src/core/idempotency';
import { formatRupees } from '../src/core/money';
import { BASE, fakeServer, sellerError } from './fake-server';

const source = (access = 'access-1', fresh: string | null = 'access-2') => {
  const calls: string[] = [];
  return {
    calls,
    accessToken: async () => access,
    refresh: async (stale: string) => {
      calls.push(stale);
      return fresh;
    },
  };
};

describe('API client', () => {
  it('sends the bearer, the app version and platform, the store and the Idempotency-Key, and no cookie', async () => {
    let init: any;
    const server = fakeServer(() => ({ body: { ok: true } }));
    const spy = (async (url: any, options: any) => {
      init = options;
      return server.fetch(url, options);
    }) as typeof fetch;
    const client = createApiClient({ baseUrl: BASE + '/', appVersion: '1.2.3', fetch: spy, tokens: source() });
    await client.request({ method: 'POST', path: '/api/mobile/v1/orders/1/notes', storeId: 's1', idempotencyKey: 'key-12345678', body: { revision: 5, text: 'hi' } });
    expect(server.seen[0]!.url).toBe(`${BASE}/api/mobile/v1/orders/1/notes`);
    expect(server.seen[0]!.headers).toMatchObject({
      authorization: 'Bearer access-1',
      'x-app-version': '1.2.3',
      'x-app-platform': 'android',
      'x-store-id': 's1',
      'idempotency-key': 'key-12345678',
      'content-type': 'application/json',
    });
    expect(init.credentials).toBe('omit');
    expect(server.seen[0]!.body).toEqual({ revision: 5, text: 'hi' });
  });

  it('refreshes once on 401 and resends the same request, same Idempotency-Key', async () => {
    const server = fakeServer((request) => (request.headers.authorization === 'Bearer access-1' ? sellerError(401, 'expired') : { body: { done: true } }));
    const tokens = source();
    const client = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch, tokens });
    await expect(client.request({ method: 'POST', path: '/x', idempotencyKey: 'key-12345678', body: { a: 1 } })).resolves.toEqual({ done: true });
    expect(tokens.calls).toEqual(['access-1']);
    expect(server.seen).toHaveLength(2);
    expect(server.seen[1]!.headers['idempotency-key']).toBe('key-12345678');
    expect(server.seen[1]!.body).toEqual(server.seen[0]!.body);
  });

  it('gives up after one refresh: a second 401 is the answer, and a dead session is not resent', async () => {
    const server = fakeServer(() => sellerError(401, 'Sign in again', 'SESSION_REVOKED'));
    const twice = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch, tokens: source() });
    await expect(twice.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
    expect(server.seen).toHaveLength(2);
    const dead = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch, tokens: source('access-1', null) });
    await expect(dead.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({ status: 401 });
    expect(server.seen).toHaveLength(3);
  });

  it('does not send anything without a session, and sends no token on sign-in', async () => {
    const server = fakeServer(() => ({ body: {} }));
    const client = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(ApiError);
    expect(server.seen).toHaveLength(0);
    await client.request({ method: 'POST', path: '/auth/login', auth: false, body: {} });
    expect(server.seen[0]!.headers.authorization).toBeUndefined();
  });

  it('reads both error envelopes and Retry-After', async () => {
    const replies = [
      { status: 422, body: { errors: [{ message: 'Not allowed', code: 'ORDER_TRANSITION_NOT_ALLOWED' }] } },
      { status: 400, body: { error: 'email is required', code: 'ACCOUNT_BODY_INVALID', field: 'email' } },
      { status: 429, body: { errors: [{ message: 'Slow down' }] }, headers: { 'retry-after': '60' } },
      { status: 500 },
    ];
    const server = fakeServer(() => replies.shift()!);
    const client = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch });
    const get = () => client.request({ method: 'GET', path: '/x', auth: false });
    await expect(get()).rejects.toMatchObject({ status: 422, code: 'ORDER_TRANSITION_NOT_ALLOWED', message: 'Not allowed' });
    await expect(get()).rejects.toMatchObject({ status: 400, code: 'ACCOUNT_BODY_INVALID', field: 'email', message: 'email is required' });
    await expect(get()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });
    await expect(get()).rejects.toMatchObject({ status: 500, code: null });
  });

  it('turns 426 into UpgradeRequired and tells the app', async () => {
    const server = fakeServer(() => ({ status: 426, body: { code: 'UPGRADE_REQUIRED', minVersion: '2.0.0', storeUrl: 'https://play.google.com/x' } }));
    const seen: UpgradeRequired[] = [];
    const client = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch, onUpgradeRequired: (error) => seen.push(error) });
    await expect(client.request({ method: 'GET', path: '/x', auth: false })).rejects.toBeInstanceOf(UpgradeRequired);
    expect(seen[0]).toMatchObject({ minVersion: '2.0.0', storeUrl: 'https://play.google.com/x' });
  });

  it('reports no network and a timeout as NetworkError', async () => {
    const offline = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: fakeServer(() => 'offline').fetch });
    await expect(offline.request({ method: 'GET', path: '/x', auth: false })).rejects.toMatchObject({ name: 'NetworkError', reason: 'offline' });
    const hangs = ((_url: unknown, init: any) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    const slow = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: hangs, timeoutMs: 5 });
    const failure = (await slow.request({ method: 'GET', path: '/x', auth: false }).catch((error: unknown) => error)) as NetworkError;
    expect(failure).toBeInstanceOf(NetworkError);
    expect(failure.reason).toBe('timeout');
  });

  it('checks an answer against the contract', async () => {
    const server = fakeServer(() => ({ body: { n: 'not a number' } }));
    const client = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch });
    const parser = { safeParse: (value: any) => (typeof value?.n === 'number' ? { success: true as const, data: value } : { success: false as const }) };
    await expect(client.request({ method: 'GET', path: '/x', auth: false }, parser)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('builds query strings without empty values', () => {
    expect(buildUrl('http://h/', '/p', { q: 'a b&c', page: 2, status: '', from: undefined, unread: false })).toBe('http://h/p?q=a%20b%26c&page=2&unread=false');
  });
});

describe('small helpers', () => {
  it('picks the server address: configured first, the Expo computer in development only, https in a release', () => {
    expect(resolveApiUrl({ configured: 'https://api.markazify.com/', devPort: 4001, dev: false })).toEqual({ ok: true, url: 'https://api.markazify.com' });
    expect(resolveApiUrl({ configured: 'http://api.markazify.com', devPort: 4001, dev: false }).ok).toBe(false);
    expect(resolveApiUrl({ configured: 'not a url', devPort: 4001, dev: true }).ok).toBe(false);
    expect(resolveApiUrl({ configured: 'http://user@evil.example', devPort: 4001, dev: true }).ok).toBe(false);
    expect(resolveApiUrl({ configured: '', hostUri: '192.168.1.5:8081', devPort: 4001, dev: true })).toEqual({ ok: true, url: 'http://192.168.1.5:4001' });
    expect(resolveApiUrl({ hostUri: '192.168.1.5:8081', devPort: 4001, dev: false }).ok).toBe(false);
    expect(resolveApiUrl({ hostUri: 'abc.exp.direct:80', devPort: 4001, dev: true }).ok).toBe(false);
  });

  it('writes whole rupees one way', () => {
    expect([formatRupees(0), formatRupees(999), formatRupees(1234567), formatRupees(1499.6), formatRupees(-2500), formatRupees(null)]).toEqual([
      'Rs 0',
      'Rs 999',
      'Rs 1,234,567',
      'Rs 1,500',
      '-Rs 2,500',
      'Rs -',
    ]);
  });

  it('makes Idempotency-Keys only from a usable random source', () => {
    expect(createIdempotencyKeyFactory(() => '0b0c9a0e-4a1d-4f2e-9a51-3c6a1f8f9b10')()).toBe('0b0c9a0e-4a1d-4f2e-9a51-3c6a1f8f9b10');
    expect(() => createIdempotencyKeyFactory(() => 'x')()).toThrow();
  });
});
