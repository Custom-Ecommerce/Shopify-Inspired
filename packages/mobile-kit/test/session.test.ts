import { createApiClient } from '../src/core/api-client';
import { clearOtherUsers, cacheStorageKey, queueStorageKey, storeQueryKey } from '../src/core/offline/cache';
import { createMobileRuntime } from '../src/core/runtime';
import { createSessionManager } from '../src/core/session';
import { memoryStore } from '../src/core/storage';
import { BASE, fakeServer, sellerError, signInAnswer, tokens, type Handler } from './fake-server';

const SESSION_KEY = 'markaz.session.seller';

function setup(handler: Handler, secrets = memoryStore(), storage = memoryStore()) {
  const server = fakeServer(handler);
  let cleared = 0;
  let n = 0;
  const runtime = createMobileRuntime({
    app: 'seller',
    baseUrl: BASE,
    appVersion: '1.0.0',
    secrets,
    storage,
    random: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    fetch: server.fetch,
    onCacheClear: () => {
      cleared += 1;
    },
  });
  return { runtime, server, secrets, storage, cleared: () => cleared };
}

/** A phone that signed in before and was started again: only the refresh token is stored. */
const storedSession = (userId = 'u1') =>
  memoryStore({
    [SESSION_KEY]: JSON.stringify({ refreshToken: 'refresh-1', refreshTokenExpiresAt: '2026-12-26T00:00:00.000Z', deviceId: 'device-1', user: { id: userId, name: 'A', email: 'a@x.pk' } }),
  });

describe('session', () => {
  it('signs in, keeps the refresh token in the secret store only, and uses the access token', async () => {
    const t = setup((request) => (request.path.endsWith('/auth/login') ? { body: signInAnswer() } : { body: { stores: [] } }));
    await t.runtime.session.restore();
    await t.runtime.session.signIn({ email: 'a@x.pk', password: 'p' });
    expect(t.runtime.session.getState()).toMatchObject({ status: 'signed_in', deviceId: 'device-1' });
    await t.runtime.client.request({ method: 'GET', path: '/api/mobile/v1/stores' });
    expect(t.server.seen[0]!.path).toBe('/api/mobile/v1/auth/login');
    expect(t.server.seen[1]!.headers.authorization).toBe('Bearer access-1');
    expect(t.secrets.data.get(SESSION_KEY)).toContain('refresh-1');
    expect(t.secrets.data.get(SESSION_KEY)).not.toContain('access-1');
    expect([...t.storage.data.values()].join('')).not.toContain('refresh-1');
  });

  it('restores without a network and runs ONE refresh for many requests, storing the new token first', async () => {
    let storedAtUse = '';
    const secrets = storedSession();
    const t = setup(async (request) => {
      if (request.path.endsWith('/auth/refresh')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { body: tokens(2) };
      }
      storedAtUse = secrets.data.get(SESSION_KEY)!;
      return { body: {} };
    }, secrets);
    expect((await t.runtime.session.restore()).status).toBe('signed_in');
    expect(t.server.seen).toHaveLength(0);
    await Promise.all([1, 2, 3].map(() => t.runtime.client.request({ method: 'GET', path: '/api/mobile/v1/stores' })));
    const refreshes = t.server.seen.filter((request) => request.path.endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.body).toEqual({ refreshToken: 'refresh-1' });
    expect(storedAtUse).toContain('refresh-2');
  });

  it('refreshes before the access token runs out', async () => {
    let clock = 0;
    const secrets = storedSession();
    const server = fakeServer(() => ({ body: tokens(2) }));
    const session = createSessionManager({
      prefix: '/api/mobile/v1',
      client: createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch }),
      secrets,
      storageKey: SESSION_KEY,
      now: () => clock,
    });
    await session.restore();
    await session.accessToken();
    clock = 800_000;
    await session.accessToken();
    expect(server.seen).toHaveLength(1);
    clock = 871_000;
    await session.accessToken();
    expect(server.seen).toHaveLength(2);
  });

  it('ends the session on a revoked device: token, cached data and queued changes are removed', async () => {
    const storage = memoryStore({ [cacheStorageKey('u1')]: '{"cached":true}', [queueStorageKey('u1')]: '[]' });
    const t = setup(() => sellerError(401, 'This session is no longer valid.', 'SESSION_REVOKED'), storedSession(), storage);
    await t.runtime.session.restore();
    await expect(t.runtime.client.request({ method: 'GET', path: '/api/mobile/v1/stores' })).rejects.toMatchObject({ status: 401 });
    expect(t.runtime.session.getState()).toMatchObject({ status: 'signed_out', endedBecause: 'revoked' });
    expect(t.secrets.data.size).toBe(0);
    expect(storage.data.size).toBe(0);
    expect(t.cleared()).toBe(1);
    expect(t.runtime.queue()).toBeNull();
  });

  it('says suspended when the account is suspended', async () => {
    const t = setup(() => sellerError(401, 'This account is suspended', 'ACCOUNT_SUSPENDED'), storedSession());
    await t.runtime.session.restore();
    await expect(t.runtime.session.accessToken()).resolves.toBeNull();
    expect(t.runtime.session.getState().endedBecause).toBe('suspended');
  });

  it('keeps the session with no network, on a server fault and when the app must update', async () => {
    for (const reply of ['offline' as const, sellerError(503, 'down'), { status: 426, body: { minVersion: '2.0.0', storeUrl: 'https://s' } }]) {
      const t = setup(() => reply, storedSession());
      await t.runtime.session.restore();
      await expect(t.runtime.session.accessToken()).rejects.toBeTruthy();
      expect(t.runtime.session.getState().status).toBe('signed_in');
      expect(t.secrets.data.get(SESSION_KEY)).toContain('refresh-1');
      if (reply !== 'offline' && reply.status === 426) expect(t.runtime.upgrade()).toEqual({ minVersion: '2.0.0', storeUrl: 'https://s' });
    }
  });

  it('signs out on the phone even with no network', async () => {
    const t = setup(() => 'offline', storedSession());
    await t.runtime.session.restore();
    await t.runtime.session.signOut();
    expect(t.runtime.session.getState()).toMatchObject({ status: 'signed_out', endedBecause: 'signed_out' });
    expect(t.secrets.data.size).toBe(0);
    expect(t.server.seen[0]).toMatchObject({ path: '/api/mobile/v1/auth/logout', body: { refreshToken: 'refresh-1' } });
  });

  it('signs out with the newest token when a refresh is running', async () => {
    const t = setup(async (request) => {
      if (request.path.endsWith('/auth/refresh')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { body: tokens(2) };
      }
      return { body: { ok: true } };
    }, storedSession());
    await t.runtime.session.restore();
    const refreshing = t.runtime.session.accessToken();
    await t.runtime.session.signOut();
    await refreshing;
    expect(t.server.seen.at(-1)!.body).toEqual({ refreshToken: 'refresh-2' });
    expect(t.secrets.data.size).toBe(0);
  });

  it('removes an earlier account\'s data after another one signs in, and keeps the installation id', async () => {
    const storage = memoryStore({ [cacheStorageKey('old')]: 'x', [queueStorageKey('old')]: 'y', 'markaz.installation': 'abc', other: 'z' });
    await clearOtherUsers(storage, 'new');
    expect([...storage.data.keys()].sort()).toEqual(['markaz.installation', 'other']);

    const t = setup(() => ({ body: signInAnswer() }));
    const first = await t.runtime.installationId();
    expect(await t.runtime.installationId()).toBe(first);
  });

  it('starts every store query key with the user and the store', () => {
    expect(storeQueryKey('u1', 's1', 'orders', { page: 1 })).toEqual(['user', 'u1', 'store', 's1', 'orders', { page: 1 }]);
  });

  it('forgets an unreadable stored session', async () => {
    const t = setup(() => ({ body: {} }), memoryStore({ [SESSION_KEY]: '{broken' }));
    expect((await t.runtime.session.restore()).status).toBe('signed_out');
    expect(t.secrets.data.size).toBe(0);
  });
});
