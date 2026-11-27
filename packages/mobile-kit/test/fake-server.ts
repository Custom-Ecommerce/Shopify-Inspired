/** A fetch that records every request and answers from a script. No network. */

export interface Seen {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | 'offline';
export type Handler = (request: Seen) => Reply | Promise<Reply>;

export const BASE = 'http://192.168.1.5:4001';

export function fakeServer(handler: Handler) {
  const seen: Seen[] = [];
  const fetch = (async (input: unknown, init: any = {}) => {
    const url = String(input);
    const request: Seen = {
      method: init.method ?? 'GET',
      url,
      path: url.slice(BASE.length).split('?')[0]!,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    seen.push(request);
    const reply = await handler(request);
    if (reply === 'offline') throw new TypeError('Network request failed');
    const headers = reply.headers ?? {};
    return {
      status: reply.status ?? 200,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => (reply.body === undefined ? '' : JSON.stringify(reply.body)),
    };
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}

export const sellerError = (status: number, message: string, code?: string) => ({ status, body: { errors: [{ message }], ...(code ? { code } : {}) } });

export const tokens = (n: number) => ({
  accessToken: `access-${n}`,
  accessTokenExpiresIn: 900,
  refreshToken: `refresh-${n}`,
  refreshTokenExpiresAt: '2026-12-26T00:00:00.000Z',
});

export const signInAnswer = (userId = 'u1') => ({ ...tokens(1), deviceId: 'device-1', user: { id: userId, name: 'Ayesha', email: 'a@example.com', role: 'seller' } });
