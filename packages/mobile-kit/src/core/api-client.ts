import { MOBILE_APP_PLATFORM_HEADER, MOBILE_APP_VERSION_HEADER } from '@markaz/contracts/mobile';
import { MOBILE_IDEMPOTENCY_HEADER } from '@markaz/contracts/mobile-data';
import { ApiError, NetworkError, UpgradeRequired, errorFromResponse } from './errors';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const STORE_ID_HEADER = 'x-store-id';

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** From the backend's root, for example /api/mobile/v1/orders. */
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** The store the screen is about (seller data routes). */
  storeId?: string;
  idempotencyKey?: string;
  /** false for sign-in, refresh and sign-out. */
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Anything that parses like a zod schema. */
export interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface AccessTokenSource {
  /** A usable access token, or null when nobody is signed in. */
  accessToken(): Promise<string | null>;
  /** The server refused `staleToken`: a newer one, or null when the session has ended. */
  refresh(staleToken: string): Promise<string | null>;
}

export interface ApiClientOptions {
  baseUrl: string;
  appVersion: string;
  platform?: 'android';
  fetch?: typeof fetch;
  timeoutMs?: number;
  tokens?: AccessTokenSource;
  onUpgradeRequired?: (error: UpgradeRequired) => void;
}

export interface ApiClient {
  request<T = unknown>(request: ApiRequest, parser?: Parser<T>): Promise<T>;
}

export function buildUrl(baseUrl: string, path: string, query?: ApiRequest['query']): string {
  const pairs = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return pairs.length ? `${url}?${pairs.join('&')}` : url;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const send = options.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init));

  async function attempt(request: ApiRequest, token: string | null): Promise<{ status: number; body: unknown; retryAfter: number | null }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      [MOBILE_APP_VERSION_HEADER]: options.appVersion,
      [MOBILE_APP_PLATFORM_HEADER]: options.platform ?? 'android',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (request.storeId) headers[STORE_ID_HEADER] = request.storeId;
    if (request.idempotencyKey) headers[MOBILE_IDEMPOTENCY_HEADER] = request.idempotencyKey;
    if (request.body !== undefined) headers['content-type'] = 'application/json';

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort);
    try {
      const response = await send(buildUrl(options.baseUrl, request.path, request.query), {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
        // Bearer only: no cookie is ever sent or kept.
        credentials: 'omit',
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      return { status: response.status, body, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null };
    } catch (error) {
      if (request.signal?.aborted && !timedOut) throw error;
      throw new NetworkError(timedOut ? 'timeout' : 'offline');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
    }
  }

  return {
    async request<T>(request: ApiRequest, parser?: Parser<T>): Promise<T> {
      const needsAuth = request.auth !== false;
      let token: string | null = null;
      if (needsAuth) {
        token = (await options.tokens?.accessToken()) ?? null;
        if (!token) throw new ApiError({ status: 401, code: 'SESSION_REVOKED', message: 'Sign in again.' });
      }

      let result = await attempt(request, token);
      // One refresh, one resend (with the same Idempotency-Key). A second 401 is the answer.
      if (result.status === 401 && token && options.tokens) {
        const fresh = await options.tokens.refresh(token);
        if (fresh) result = await attempt(request, fresh);
      }

      if (result.status < 200 || result.status >= 300) {
        const error = errorFromResponse(result.status, result.body, result.retryAfter);
        if (error instanceof UpgradeRequired) options.onUpgradeRequired?.(error);
        throw error;
      }
      if (!parser) return result.body as T;
      const parsed = parser.safeParse(result.body);
      if (!parsed.success) {
        throw new ApiError({ status: result.status, code: 'BAD_RESPONSE', message: 'The server sent an answer this app cannot read.' });
      }
      return parsed.data;
    },
  };
}
