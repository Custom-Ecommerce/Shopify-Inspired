import mongoose from 'mongoose';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, SESSION_MIN_SECRET_LENGTH, sessionTokenVersion, verifySession } from '@/lib/services';
import type { Actor } from '@markaz/auth';
import { HttpError } from '@/lib/http';
import { requireSellerAppVersion, sellerMobileDeps } from '@/lib/mobile-auth';
import { MOBILE_SELLER_AUDIENCE, liveMobileDevice, verifyMobileAccessToken } from '@/lib/services';
import { checkSellerSession } from '@/lib/session-user';
import type { SellerRole } from '@markaz/auth';

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
  /**
   * Sprint 8 (S8-B3): the role this user holds in the store the request is about, set by resolveStoreAccess (owner, manager, staff or support; null for an admin). Undefined until a
   * route has resolved its store. The audit entries of member actions carry it (auditActorOf).
   */
  storeRole?: SellerRole | null;
}

/** What a request signed in by a phone carries besides the context. Kept beside it, so the context of a phone and of the web are the same object shape. */
const mobileSessions = new WeakMap<object, { deviceId: string }>();

/** The phone session of this request, or undefined for a web session. */
export function mobileSessionOf(ctx: AuthContext): { deviceId: string } | undefined {
  return mobileSessions.get(ctx);
}

/**
 * Sprint 9 (EP-31.US01.T04): a phone's access token (its own audience, 15 minutes, only ever from the Authorization header). The account is checked like a
 * web session's, and then the device: a revoked, expired or unknown family is refused at once.
 */
async function authenticateMobile(token: string, secret: string, headers: Headers): Promise<AuthContext> {
  let claims: Awaited<ReturnType<typeof verifyMobileAccessToken>>;
  try {
    claims = await verifyMobileAccessToken(token, secret, MOBILE_SELLER_AUDIENCE);
  } catch {
    throw new HttpError(401, 'Invalid or expired session');
  }
  if (claims.role !== 'seller' || !mongoose.isValidObjectId(claims.sub)) throw new HttpError(401, 'Invalid or expired session');
  // T08: an app that is too old is told to update, on every route it calls.
  await requireSellerAppVersion(headers);

  const account = await checkSellerSession({ sub: claims.sub, role: 'seller', tv: claims.tv });
  const device = await liveMobileDevice(await sellerMobileDeps(), claims);
  if (!device) throw new HttpError(401, 'This session is no longer valid. Sign in again.', 'SESSION_REVOKED');

  const ctx: AuthContext = {
    userId: claims.sub,
    userObjectId: new mongoose.Types.ObjectId(claims.sub),
    role: 'seller',
    actor: 'seller',
    tokenVersion: claims.tv,
    ...(account ? { emailVerified: account.emailVerifiedAt !== null } : {}),
  };
  mobileSessions.set(ctx, { deviceId: device.id });
  return ctx;
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
    // Not a web session. A phone token is only looked at when it came in the Authorization header as Bearer, never from a cookie.
    if (/^bearer\s/i.test(request.headers.get('authorization') ?? '')) return authenticateMobile(token, secret, request.headers);
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

/**
 * The actor string of an audit entry for a seller session: "seller:<userId>" for the owner (as it always was) and "seller:<userId>:<role>" for a member, so an entry records the member's user id AND
 * role. A route that has not resolved a store (the account routes) has no role and is the plain form.
 */
export function auditActorOf(ctx: Pick<AuthContext, 'userId' | 'storeRole'>): string {
  const base = 'seller:' + ctx.userId;
  return ctx.storeRole === 'manager' || ctx.storeRole === 'staff' || ctx.storeRole === 'support' ? base + ':' + ctx.storeRole : base;
}
