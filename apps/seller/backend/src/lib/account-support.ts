import mongoose from 'mongoose';
import { resolveClientIp } from '@markaz/platform-kit/client-ip';
import type { AccountFlowDeps, AuthRateLimiter, AuthTokenModelPort, AccountUserModelPort, RateCounterStore } from '@markaz/auth';
import type { AuthContext } from '@/lib/auth';
import { issueToken, tokenVersionOf } from '@/lib/accounts';
import { ACCOUNT_CODES } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { databaseReady, enqueueEmail } from '@/lib/notifications';
import { forgetSessionUser } from '@/lib/session-user';
import {
  AuthToken,
  createAuthRateLimiter,
  hashPassword,
  memoryRateCounterStore,
  mongoRateCounterStore,
  RateLimitCounter,
  User,
  LOGIN_ACCOUNT_RULE,
  verifyPassword,
  writeAuditLog,
} from '@/lib/services';

/** A wrong current password on the account page counts in the same bucket as a failed login of that account. */
const LOGIN_ACCOUNT_RULE_FOR_CHECK = LOGIN_ACCOUNT_RULE;

/**
 * Sprint 4 EP-08: what the seller account routes share. The limiter on the shared MongoDB counters (D-081), the client
 * address, the dependencies of the account flows in @markaz/auth, and requireVerifiedEmail for SB-4 and SB-7.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Limits

async function databaseOpen(): Promise<boolean> {
  await connectSellerDb();
  return mongoose.connection.readyState === 1;
}

let store: RateCounterStore = mongoRateCounterStore(RateLimitCounter as unknown as Parameters<typeof mongoRateCounterStore>[0], databaseOpen);

export const authLimiter: AuthRateLimiter = createAuthRateLimiter(() => store);

/** Test seam: in-process counters. Returns the store so a test can read it. */
export function useMemoryAuthLimits(): ReturnType<typeof memoryRateCounterStore> {
  const memory = memoryRateCounterStore();
  store = memory;
  return memory;
}

/**
 * The caller's address for the per-IP limits: the trusted-proxy rule (TRUSTED_PROXY_HOPS or TRUSTED_CLIENT_IP_HEADER),
 * never a raw x-forwarded-for. Without a setting every caller shares one bucket, 'unknown'.
 */
export function clientAddress(headers: Headers): string {
  return resolveClientIp(headers, process.env) ?? 'unknown';
}

// ---------------------------------------------------------------------------------------------------------------------
// Account flows

/** Links in account emails go to the seller portal (APP_BASE_URL_SELLER), e.g. /reset-password?token=... */
export function sellerPortalLink(pathAndQuery: string): string | null {
  try {
    const raw = process.env.APP_BASE_URL_SELLER;
    if (!raw) return null;
    const root = new URL(raw);
    return root.origin + root.pathname.replace(/\/+$/, '') + pathAndQuery;
  } catch {
    return null;
  }
}

export function sellerAccountDeps(): AccountFlowDeps {
  return {
    users: User as unknown as AccountUserModelPort,
    tokens: AuthToken as unknown as AuthTokenModelPort,
    hashPassword: (plain) => hashPassword(plain) as Promise<string>,
    // Only with an open connection (always so in a route); the unit tests stub it, and then nothing is queued.
    sendEmail: (email) => (databaseReady() ? enqueueEmail({ template: email.template, to: email.to, vars: email.vars, dedupeKey: email.dedupeKey }) : undefined),
    link: sellerPortalLink,
    forgetSession: forgetSessionUser,
    role: 'seller',
    appName: 'Markazify',
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Verified email (D-093): SB-4 go-live and SB-7 payouts call this

/**
 * Throws 403 EMAIL_NOT_VERIFIED unless the signed-in seller's email is verified. Uses the session guard's read when
 * authenticate() had one, otherwise reads the account.
 */
export async function requireVerifiedEmail(ctx: AuthContext): Promise<void> {
  let verified = ctx.emailVerified;
  if (verified === undefined) {
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const user = (await User.findById(ctx.userObjectId).select('emailVerifiedAt').lean()) as { emailVerifiedAt?: unknown } | null;
    verified = Boolean(user && user.emailVerifiedAt);
  }
  if (!verified) {
    throw new HttpError(403, 'Verify your email address first. We can send the link again from your dashboard.', ACCOUNT_CODES.EMAIL_NOT_VERIFIED);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Body parsing for the account routes: 400 with the field name (the standard route order)

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code?: string; keys?: unknown[] }> } };
}

export async function readAccountBody<T>(request: Request, schema: Schema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, 'The request body must be JSON', ACCOUNT_CODES.BODY_INVALID, 'body');
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const unknownKey = issue?.code === 'unrecognized_keys' && Array.isArray(issue.keys) ? issue.keys[0] : undefined;
  const field = unknownKey !== undefined ? String(unknownKey) : issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'body';
  throw new HttpError(400, issue?.message ?? 'Invalid request', ACCOUNT_CODES.BODY_INVALID, field);
}

export const NO_STORE = { 'Cache-Control': 'no-store' };

// ---------------------------------------------------------------------------------------------------------------------
// Session version (password change, email swap, "sign out of all other devices")

/**
 * Bumps the account's tokenVersion in ONE compare-and-set on the version this session carries, so every other session
 * stops working, and returns a fresh token for THIS session. A lost race (another session changed the account first)
 * is 409 SESSION_REVOKED: the caller signs in again. `set` holds the other fields of the same write (a new hash).
 */
export async function bumpTokenVersion(ctx: AuthContext, set: Record<string, unknown> = {}): Promise<{ token: string; tokenVersion: number }> {
  const current = ctx.tokenVersion;
  const filter = { _id: ctx.userObjectId, role: 'seller', tokenVersion: current === 0 ? { $in: [0, null] } : current };
  const update = Object.keys(set).length > 0 ? { $set: set, $inc: { tokenVersion: 1 } } : { $inc: { tokenVersion: 1 } };
  const updated = (await User.findOneAndUpdate(filter, update, { new: true }).select('tokenVersion').lean()) as { tokenVersion?: unknown } | null;
  forgetSessionUser(ctx.userId);
  if (!updated) throw new HttpError(409, 'Your account was changed in another session. Sign in again.', ACCOUNT_CODES.SESSION_REVOKED);
  const tokenVersion = tokenVersionOf(updated);
  return { token: await issueToken(ctx.userId, 'seller', tokenVersion), tokenVersion };
}

/** Best-effort audit entry for an account change: a failure is logged, never answered. */
export async function auditAccount(ctx: AuthContext, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'user', ctx.userId, 'seller:' + ctx.userId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the account audit entry', { action, error: err instanceof Error ? err.message : 'unknown' });
  }
}

/** The current password check of the account page. Wrong is 400 PASSWORD_INCORRECT and counts as a login failure. */
export async function verifyCurrentPassword(ctx: AuthContext, password: string): Promise<{ email: string; name: string | null }> {
  const user = (await User.findById(ctx.userObjectId).select('+passwordHash email name').lean()) as {
    passwordHash?: unknown;
    email?: unknown;
    name?: unknown;
  } | null;
  if (!user) throw new HttpError(401, 'Invalid or expired session');
  const email = String(user.email ?? '');
  await authLimiter.assertBelow(LOGIN_ACCOUNT_RULE_FOR_CHECK, email);
  const ok = typeof user.passwordHash === 'string' && user.passwordHash !== '' && (await verifyPassword(password, user.passwordHash));
  if (!ok) {
    await authLimiter.record(LOGIN_ACCOUNT_RULE_FOR_CHECK, email);
    throw new HttpError(400, 'The current password is not right.', ACCOUNT_CODES.PASSWORD_INCORRECT, 'currentPassword');
  }
  return { email, name: typeof user.name === 'string' ? user.name : null };
}

