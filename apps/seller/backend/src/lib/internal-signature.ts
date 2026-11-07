import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import * as signatureNs from '@markaz/platform-kit/internal-signature';
import { unwrapCjs } from '@/lib/cjs';
import { jsonError } from '@/lib/http';

// The kit re-exports through CommonJS. Read it through the default object, as lib/preview-token.ts does.
const { INTERNAL_ADMIN_HEADER, INTERNAL_SECRET_MIN_LENGTH, INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER, verifyInternalSignature } =
  unwrapCjs(signatureNs) as typeof signatureNs;

/** A moderation call is a few hundred bytes. */
const MAX_BODY_BYTES = 16 * 1024;

export type SignedRequest = { ok: true; rawBody: string; adminId: string } | { ok: false; response: NextResponse };

/**
 * The only way into /api/internal/moderation. A seller session means nothing here: only a signature made with
 * MODERATION_API_SECRET does. A missing or short secret closes the routes with a 503, as a preview link does. Anything
 * wrong with a signature is the same bare 401, so a caller learns nothing about which part failed.
 */
export async function readSignedRequest(request: NextRequest): Promise<SignedRequest> {
  const secret = process.env.MODERATION_API_SECRET;
  if (secret === undefined || secret.length < INTERNAL_SECRET_MIN_LENGTH) {
    return { ok: false, response: jsonError(503, 'Moderation is not configured') };
  }

  const unauthorized = (): SignedRequest => ({ ok: false, response: jsonError(401, 'Unauthorized') });
  const rawBody = await request.text().catch(() => null);
  if (rawBody === null || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return unauthorized();

  const adminId = request.headers.get(INTERNAL_ADMIN_HEADER);
  const valid = verifyInternalSignature({
    secret,
    method: request.method,
    path: request.nextUrl.pathname + request.nextUrl.search,
    timestamp: request.headers.get(INTERNAL_TIMESTAMP_HEADER),
    adminId,
    signature: request.headers.get(INTERNAL_SIGNATURE_HEADER),
    body: rawBody,
  });
  if (!valid || adminId === null) return unauthorized();
  return { ok: true, rawBody, adminId };
}
