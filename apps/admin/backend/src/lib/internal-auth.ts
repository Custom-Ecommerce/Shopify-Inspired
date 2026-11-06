
import {
  SYNC_HEADER_KEY_ID,
  SYNC_HEADER_SIGNATURE,
  SYNC_HEADER_TIMESTAMP,
  verifySyncSignature,
} from '@markaz/platform-kit';

const MAX_BODY_BYTES = 64 * 1024;

export type InternalAuth = { ok: true; rawBody: string } | { ok: false; response: Response };

export function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  const pairs: Array<[string | undefined, string | undefined]> = [
    [process.env.SYNC_KEY_ID_CURRENT, process.env.SYNC_SECRET_CURRENT],
    [process.env.SYNC_KEY_ID_PREVIOUS, process.env.SYNC_SECRET_PREVIOUS],
  ];
  for (const [keyId, secret] of pairs) {
    if (keyId && secret) secrets[keyId] = secret;
  }
  return secrets;
}

/** Verifies the HMAC over the exact raw bytes before any field is trusted. Call once per request. */
export async function requireInternalSignature(request: Request): Promise<InternalAuth> {
  const secrets = loadSecrets();
  if (Object.keys(secrets).length === 0) {
    return { ok: false, response: jsonResponse({ error: 'Internal calls are not configured.' }, 503) };
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, response: jsonResponse({ error: 'Request body too large.' }, 413) };
  }
  const verified = verifySyncSignature({
    secrets,
    keyId: request.headers.get(SYNC_HEADER_KEY_ID),
    timestamp: request.headers.get(SYNC_HEADER_TIMESTAMP),
    signature: request.headers.get(SYNC_HEADER_SIGNATURE),
    rawBody,
  });
  if (!verified.ok) return { ok: false, response: jsonResponse({ error: 'Unauthorized.' }, 401) };
  return { ok: true, rawBody };
}
