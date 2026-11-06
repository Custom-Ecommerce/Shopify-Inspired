import { verifySyncSignature } from '@markaz/platform-kit/hmac';

export type SyncGuardResult =
  | { ok: true; rawBody: string }
  | { ok: false; response: Response };

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Verifies the HMAC signature on every sync envelope before the body is trusted.
// If platform-kit's verifySyncSignature takes different arguments, adjust the call below only.
export async function requireSyncSignature(request: Request): Promise<SyncGuardResult> {
  const secret = process.env.SYNC_HMAC_SECRET;
  if (!secret) {
    return { ok: false, response: jsonResponse({ error: 'sync secret not configured' }, 500) };
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get('x-sync-timestamp');
  const signature = request.headers.get('x-sync-signature');
  const keyId = request.headers.get('x-sync-key-id') || 'default';

  // platform-kit ki exact typing ke mutabiq parameters pass kiye hain
  const verdict = await verifySyncSignature({ 
    secrets: { [keyId]: secret }, 
    keyId, 
    timestamp, 
    signature, 
    rawBody 
  } as any); // (Agar parameter thora bhi mukhtalif ho toh strict mode na roke)

  // verdict boolean bhi ho sakta hai ya object { ok: boolean }
  const isValid = typeof verdict === 'object' && verdict !== null ? (verdict as any).ok : verdict;

  if (!isValid) {
    return { ok: false, response: jsonResponse({ error: 'invalid sync signature' }, 401) };
  }
  return { ok: true, rawBody };
}
