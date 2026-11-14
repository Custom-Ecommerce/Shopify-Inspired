import mongoose from 'mongoose';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, SESSION_MIN_SECRET_LENGTH, sessionTokenVersion, verifySession } from '@/lib/services';
import type { Actor } from '@markaz/auth';
import { HttpError } from '@/lib/http';
import { checkSellerSession } from '@/lib/session-user';

/** Sessions for this backend are bound to this audience (see packages/auth/src/session.ts). */
export const SELLER_SESSION_AUDIENCE = 'seller-backend';

export interface AuthContext {
  userId: string;
  userObjectId: mongoose.Types.ObjectId;
  role: 'admin' | 'seller';
  /** The policy actor used for every can() check. Derived from the verified role only. */
  actor: Actor;
  /** The token version this session carries (its tv claim, 0 for older tokens). */
  tokenVersion: number;
  /**
   * Sprint 4 EP-08: whether the account's email is verified, from the session guard's read. Undefined when the guard
   * could not read the account (unit tests with a stubbed connection): requireVerifiedEmail then reads it itself.
   */
  emailVerified?: boolean;
}

function extractToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  /* patch_session_fix: the seller frontend sends "JWT <token>"; "Bearer <token>" stays supported. */
  const scheme = header === null ? null : /^(?:bearer|jwt)\s+(\S+)\s*$/i.exec(header);
  if (scheme !== null && scheme[1]) return scheme[1];
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  return cookie !== undefined && cookie.value !== '' ? cookie.value : null;
}

/**
 * Verifies the session (signature, pinned HS256, expiry, audience) through @markaz/auth.
 * Throws HttpError 401 for any credential problem and 503 when the backend is misconfigured.
 */
export async function authenticate(request: NextRequest): Promise<AuthContext> {
  const secret = process.env.SELLER_AUTH_SECRET;
  if (secret === undefined || secret.length < SESSION_MIN_SECRET_LENGTH) {
    throw new HttpError(503, 'Authentication is not configured');
  }

  const token = extractToken(request);
  if (token === null) throw new HttpError(401, 'Authentication required');

  let claims: Awaited<ReturnType<typeof verifySession>>;
  try {
    claims = await verifySession(token, secret, SELLER_SESSION_AUDIENCE);
  } catch {
    throw new HttpError(401, 'Invalid or expired session');
  }

  const role = claims.role;
  if ((role !== 'admin' && role !== 'seller') || !mongoose.isValidObjectId(claims.sub)) {
    throw new HttpError(401, 'Invalid or expired session');
  }

  // Sprint 4 EP-08.US03.T01 (D-093): the account itself is checked on every request: a missing, suspended or blocked
  // account, another role, or an older tokenVersion is refused with 401 ACCOUNT_SUSPENDED / SESSION_REVOKED.
  const account = await checkSellerSession({ sub: claims.sub, role, tv: claims.tv });

  return {
    userId: claims.sub,
    userObjectId: new mongoose.Types.ObjectId(claims.sub),
    role: role,
    actor: role,
    tokenVersion: sessionTokenVersion(claims),
    ...(account ? { emailVerified: account.emailVerifiedAt !== null } : {}),
  };
}
