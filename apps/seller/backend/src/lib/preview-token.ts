import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import * as previewNs from '@markaz/platform-kit/preview';
import { unwrapCjs } from '@/lib/cjs';
import { HttpError } from '@/lib/http';

// The kit re-exports through CommonJS. Read it through the default object, as lib/revalidate.ts does.
const { PREVIEW_PURPOSE, PREVIEW_TOKEN_TTL_SECONDS, isPreviewTokenShape } = unwrapCjs(previewNs) as typeof previewNs;

/**
 * The preview link of a store (D-018, D-019). This file is the only place one is made or read.
 *
 * The link is a short-lived signed token that says "this holder may look at the unpublished version of store X". It has
 * its own secret and its own audience, so a session token cannot open a preview and a preview token cannot start a
 * session, even if the two secrets were ever set to the same value.
 */

/** The audience of preview tokens. Sessions use 'seller-backend', so the two can never stand in for each other. */
export const PREVIEW_AUDIENCE = 'seller-preview';

/** Same floor as the session secret. */
export const PREVIEW_MIN_SECRET_LENGTH = 32;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** The key, or null when preview is not configured. */
function previewKey(): Uint8Array | null {
  const secret = process.env.PREVIEW_TOKEN_SECRET;
  if (secret === undefined || secret.length < PREVIEW_MIN_SECRET_LENGTH) return null;
  return new TextEncoder().encode(secret);
}

export interface PreviewLink {
  token: string;
  expiresAt: Date;
}

/**
 * A new link for one store, valid for 24 hours. Every call makes a new one. A missing or short secret is a 503: preview
 * is switched off rather than signed with something weaker.
 */
export async function signPreviewLink(storeId: string): Promise<PreviewLink> {
  const key = previewKey();
  if (key === null) throw new HttpError(503, 'Preview is not configured');
  if (!OBJECT_ID.test(storeId)) throw new HttpError(422, 'storeId must be a 24-character ObjectId');

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + PREVIEW_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({ purpose: PREVIEW_PURPOSE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(storeId.toLowerCase())
    .setAudience(PREVIEW_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key);
  return { token, expiresAt: new Date(expiresAt * 1000) };
}

export interface PreviewCheck {
  ok: boolean;
}

/**
 * Does this token open the preview of this store? True only when the signature, the algorithm, the expiry, the audience,
 * the purpose and the store all match. Anything else, including a missing secret, is simply false: the caller serves the
 * live store and says nothing about why.
 */
export async function readPreviewLink(token: unknown, storeId: string): Promise<PreviewCheck> {
  const key = previewKey();
  if (key === null || !isPreviewTokenShape(token) || !OBJECT_ID.test(storeId)) return { ok: false };
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      audience: PREVIEW_AUDIENCE,
      requiredClaims: ['sub', 'exp', 'iat', 'jti'],
    });
    const sameStore = typeof payload.sub === 'string' && payload.sub.toLowerCase() === storeId.toLowerCase();
    return { ok: payload.purpose === PREVIEW_PURPOSE && sameStore };
  } catch {
    return { ok: false };
  }
}
