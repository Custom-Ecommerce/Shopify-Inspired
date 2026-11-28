import { createMobileRuntime, memoryStore } from '@markaz/mobile-kit/core';
import type { PushPort } from '@markaz/mobile-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { createRecoveryHolder, ServicesProvider, type Services } from '../src/services';

export const BASE = 'http://192.168.1.5:4010';
export const ID = '65c000000000000000000001';

export interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
}
export type Reply = { status?: number; body?: unknown } | 'offline' | undefined;

export const fakePush = (over: Partial<PushPort> = {}): PushPort => ({
  available: () => ({ ok: false, reason: 'Expo Go cannot receive push notifications. The installed app can.' }),
  register: async () => ({ ok: false, reason: 'no' }),
  onTap: () => () => undefined,
  ...over,
});

export const signInAnswer = (level: string, extra: object = {}) => ({
  accessToken: 'a1',
  accessTokenExpiresIn: 900,
  refreshToken: 'r1',
  refreshTokenExpiresAt: '2026-12-26T00:00:00.000Z',
  deviceId: 'd1',
  user: { id: 'u1', name: 'Bilal', email: 'admin@x.pk' },
  adminLevel: level,
  capabilities: [],
  ...extra,
});

export interface Setup {
  /** Answers a request; undefined falls back to the defaults (sign-in and /me for the level). */
  handler?: (request: Seen) => Reply;
  level?: string;
  push?: PushPort;
  signIn?: boolean;
}

export async function setup(options: Setup = {}) {
  const level = options.level ?? 'owner';
  const seen: Seen[] = [];
  let ready = options.signIn === false;
  const fetch = (async (input: unknown, init: any = {}) => {
    const url = String(input);
    const [path, search = ''] = url.slice(BASE.length).split('?');
    const request: Seen = {
      method: init.method,
      path: path!,
      query: Object.fromEntries(new URLSearchParams(search)),
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    seen.push(request);
    let reply = ready ? options.handler?.(request) : undefined;
    if (reply === undefined) {
      if (path!.endsWith('/auth/login')) reply = { body: signInAnswer(level) };
      else if (path === '/api/admin/me') reply = { body: { user: { id: 'u1', name: 'Bilal', email: 'admin@x.pk' }, adminLevel: level, capabilities: [] } };
      else reply = { status: 404, body: { error: 'Not found' } };
    }
    if (reply === 'offline') throw new TypeError('Network request failed');
    const { status = 200, body } = reply;
    return { status, headers: { get: () => null }, text: async () => JSON.stringify(body ?? {}) };
  }) as unknown as typeof globalThis.fetch;

  let n = 0;
  const storage = memoryStore();
  const runtime = createMobileRuntime({
    app: 'admin',
    baseUrl: BASE,
    appVersion: '1.0.0',
    secrets: memoryStore(),
    storage,
    random: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    fetch,
  });
  await runtime.session.restore();
  if (options.signIn !== false) {
    await runtime.session.signIn({});
    seen.length = 0;
    ready = true;
  }
  const recovery = createRecoveryHolder();
  const services: Services = { runtime, storage, appVersion: '1.0.0', deviceName: 'Test phone', push: options.push ?? fakePush(), recovery };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  const show = (ui: ReactElement) =>
    render(
      <QueryClientProvider client={queryClient}>
        <ServicesProvider value={services}>{ui}</ServicesProvider>
      </QueryClientProvider>,
    );

  const requests = (path: string, method?: string) => seen.filter((r) => r.path.endsWith(path) && (!method || r.method === method));
  return { seen, requests, runtime, storage, services, recovery, queryClient, show };
}
