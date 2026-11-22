/**
 * S7-B5: adding and removing a custom domain on the Vercel project, behind a port. The real one calls the Vercel REST API with fetch when
 * VERCEL_API_TOKEN and VERCEL_PROJECT_ID are both set; otherwise a stub records the call and says success. The token is sent in a header
 * and is never logged or returned. A failure answers { ok: false, reason } and never throws.
 */

export interface VercelResult {
  ok: boolean;
  /** A short code when not ok: vercel_unreachable, vercel_timeout, vercel_http_<status> or the Vercel error code. */
  reason?: string;
}

export interface VercelDomainsPort {
  /** True when this port talks to Vercel (false for the stub). */
  readonly configured: boolean;
  addDomain(host: string): Promise<VercelResult>;
  removeDomain(host: string): Promise<VercelResult>;
}

export const VERCEL_TIMEOUT_MS = 8000;
const API = 'https://api.vercel.com';

/** The stub: records each call and succeeds. */
export function createStubVercelDomains(): VercelDomainsPort & { calls: Array<{ op: 'add' | 'remove'; host: string }> } {
  const calls: Array<{ op: 'add' | 'remove'; host: string }> = [];
  return {
    configured: false,
    calls,
    async addDomain(host) {
      calls.push({ op: 'add', host });
      return { ok: true };
    },
    async removeDomain(host) {
      calls.push({ op: 'remove', host });
      return { ok: true };
    },
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const codeOf = async (response: Response): Promise<string | null> => {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code === 'string' && /^[a-z0-9_]{1,60}$/i.test(code) ? code : null;
  } catch {
    return null;
  }
};

export function createVercelDomains(options: { token: string; projectId: string; fetch?: FetchLike; timeoutMs?: number }): VercelDomainsPort {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? VERCEL_TIMEOUT_MS;
  const project = encodeURIComponent(options.projectId);
  const call = async (method: 'POST' | 'DELETE', url: string, body?: unknown): Promise<{ response: Response } | { failed: VercelResult }> => {
    try {
      const response = await doFetch(url, {
        method,
        headers: { authorization: 'Bearer ' + options.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { response };
    } catch (err) {
      const name = (err as { name?: unknown } | null)?.name;
      return { failed: { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'vercel_timeout' : 'vercel_unreachable' } };
    }
  };
  return {
    configured: true,
    async addDomain(host) {
      const result = await call('POST', API + '/v10/projects/' + project + '/domains', { name: host });
      if ('failed' in result) return result.failed;
      const { response } = result;
      if (response.ok) return { ok: true };
      const code = await codeOf(response);
      // Already on this project: the state we want.
      if (response.status === 409 && code === 'domain_already_in_this_project') return { ok: true };
      return { ok: false, reason: code ?? 'vercel_http_' + response.status };
    },
    async removeDomain(host) {
      const result = await call('DELETE', API + '/v9/projects/' + project + '/domains/' + encodeURIComponent(host));
      if ('failed' in result) return result.failed;
      const { response } = result;
      if (response.ok || response.status === 404) return { ok: true };
      return { ok: false, reason: (await codeOf(response)) ?? 'vercel_http_' + response.status };
    },
  };
}

let override: VercelDomainsPort | null = null;
let stub: ReturnType<typeof createStubVercelDomains> | null = null;

/** Test seam: replaces the port (null puts the environment's back). */
export function setVercelDomains(port: VercelDomainsPort | null): void {
  override = port;
}

export function getVercelDomains(env: Record<string, string | undefined> = process.env): VercelDomainsPort {
  if (override) return override;
  const token = env.VERCEL_API_TOKEN?.trim();
  const projectId = env.VERCEL_PROJECT_ID?.trim();
  if (token && projectId) return createVercelDomains({ token, projectId });
  stub ??= createStubVercelDomains();
  return stub;
}
