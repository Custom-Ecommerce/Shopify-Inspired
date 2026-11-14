import mongoose from 'mongoose';
import { connectDb } from '@/lib/db';
import { RateLimitedError, SESSION_MIN_SECRET_LENGTH, SessionRejectedError, hashPassword, sessionTokenVersion, signSession, verifySession } from '@/lib/workspace';

/** Sessions for the admin backend are bound to this audience. A seller token is refused here, and the reverse. */
export const ADMIN_AUDIENCE = 'admin-backend';
const NO_STORE = { 'Cache-Control': 'no-store' };

export class AdminHttpError extends Error {
  readonly status: number;
  /** Sprint 4: an optional machine code (ACCOUNT_CODES in contracts) and the body field it is about. */
  readonly code: string | undefined;
  readonly field: string | undefined;

  constructor(status: number, message: string, code?: string, field?: string) {
    super(message);
    this.name = 'AdminHttpError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AdminHttpError) {
    return Response.json(
      { error: err.message, ...(err.code === undefined ? {} : { code: err.code }), ...(err.field === undefined ? {} : { field: err.field }) },
      { status: err.status, headers: NO_STORE },
    );
  }
  // Sprint 4 EP-08 (D-093): a verified token whose account is suspended, gone, or on an older tokenVersion.
  if (err instanceof SessionRejectedError) {
    return Response.json({ error: err.message, code: err.code }, { status: 401, headers: NO_STORE });
  }
  if (err instanceof RateLimitedError) {
    return Response.json(
      { error: err.message, code: 'RATE_LIMITED', retryAfterSeconds: err.retryAfterSeconds },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(err.retryAfterSeconds) } },
    );
  }
  console.error('admin session route failed:', err instanceof Error ? err.message : 'unknown error');
  return Response.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
}

export interface LoginInput {
  email: string;
  password: string;
}

export type ParsedLogin = { ok: true; data: LoginInput } | { ok: false; issues: Array<{ path: string; message: string }> };

/** Checks the sign-in body. Sizes are bounded so a hostile body cannot make the password hash expensive. */
export function parseLogin(input: unknown): ParsedLogin {
  const issues: Array<{ path: string; message: string }> = [];
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  if (email.length < 3 || email.length > 254 || !email.includes('@')) {
    issues.push({ path: 'email', message: 'must be a valid email address' });
  }
  if (password.length < 1 || password.length > 1024) {
    issues.push({ path: 'password', message: 'is required (up to 1024 characters)' });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, data: { email, password } };
}

export function requireAdminSecret(): string {
  const secret = process.env.ADMIN_AUTH_SECRET;
  if (secret === undefined || secret.length < SESSION_MIN_SECRET_LENGTH) {
    throw new AdminHttpError(503, 'Authentication is not configured');
  }
  return secret;
}

export async function requireDatabase(): Promise<void> {
  try {
    await connectDb();
  } catch {
    throw new AdminHttpError(503, 'Admin database is unavailable');
  }
}

/** tokenVersion is the account's current one (Sprint 4 EP-08): a token with an older one is refused by authorizeAdmin. */
export async function issueAdminToken(userId: string, tokenVersion: number = 0): Promise<string> {
  return signSession({ sub: userId, role: 'admin', tv: tokenVersion }, requireAdminSecret(), ADMIN_AUDIENCE);
}

export function extractBearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token === '' ? null : token;
}

/** Verifies signature, expiry, and audience, and that the token was minted for an admin. No database access. */
export async function authenticateAdmin(request: Request): Promise<{ userId: string; tokenVersion: number }> {
  const secret = requireAdminSecret();
  const token = extractBearer(request);
  if (token === null) throw new AdminHttpError(401, 'Authentication required');

  let claims: Awaited<ReturnType<typeof verifySession>>;
  try {
    claims = await verifySession(token, secret, ADMIN_AUDIENCE);
  } catch {
    throw new AdminHttpError(401, 'Invalid or expired session');
  }
  if (claims.role !== 'admin' || !mongoose.isValidObjectId(claims.sub)) {
    throw new AdminHttpError(401, 'Invalid or expired session');
  }
  return { userId: String(claims.sub), tokenVersion: sessionTokenVersion(claims) };
}

let dummyHash: Promise<string> | null = null;

/** A real hash to compare against when the email is unknown, so an unknown email takes as long as a wrong password. */
export function dummyPasswordHash(): Promise<string> {
  if (dummyHash === null) {
    const pending: Promise<string> = Promise.resolve(hashPassword('a-password-nobody-uses-for-timing')).then((hash: unknown) => {
      if (typeof hash !== 'string' || hash.length === 0) throw new Error('dummy password hash was not produced');
      return hash;
    });
    // A failed attempt must not be cached for the life of the process.
    pending.catch(() => {
      if (dummyHash === pending) dummyHash = null;
    });
    dummyHash = pending;
  }
  return dummyHash;
}

/** The session user, in the shape the contracts name SessionUser (id, not _id; no secret fields). */
export function sessionUserOf(user: { _id: unknown; name: string; email: string; role: string; store?: unknown }): {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'seller';
  store: string | null;
} {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as 'admin' | 'seller',
    store: user.store ? String(user.store) : null,
  };
}
