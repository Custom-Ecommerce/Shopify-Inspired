
import { buildSyncHeaders } from '@markaz/platform-kit/hmac';
import { jsonResponse, requireEnv } from './_shared';

/** Forwards a signed POST to an admin internal route and returns its response unchanged. */
export async function callAdminBridge(path: string, payload: unknown): Promise<Response> {
  let base = requireEnv('ADMIN_BACKEND_API_URL') ?? '';
  while (base.endsWith('/')) base = base.slice(0, -1);
  const keyId = requireEnv('SYNC_KEY_ID_CURRENT');
  const secret = requireEnv('SYNC_SECRET_CURRENT');
  
  if (!base || !keyId || !secret) {
    return jsonResponse({ error: 'admin billing bridge is not configured' }, 500);
  }
  
  const body = JSON.stringify(payload);
  const headers = buildSyncHeaders({ keyId, secret, rawBody: body });
  const upstream = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(15000),
  });
  
  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } });
}
