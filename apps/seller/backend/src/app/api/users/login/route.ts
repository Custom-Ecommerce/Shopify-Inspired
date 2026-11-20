import { loginRequestSchema } from '@/lib/contracts';
import { issueToken, requireDatabase, sessionUserOf, tokenVersionOf } from '@/lib/accounts';
import { authLimiter, clientAddress } from '@/lib/account-support';
import { HttpError, handleRouteError } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { hashPassword, LOGIN_ACCOUNT_RULE, LOGIN_IP_RULE, User, verifyPassword } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVALID_CREDENTIALS = 'Invalid email or password';

/** Field names an older seed/schema may have used for the bcrypt hash. */
const LEGACY_HASH_FIELDS = ['password', 'password_hash', 'hashedPassword', 'hash', 'passwordhash'] as const;

const isBcryptHash = (value: unknown): value is string =>
  typeof value === 'string' && /^\$2[abxy]?\$\d{2}\$.{53}$/.test(value);

/**
 * Returns the bcrypt hash for a user, or null. Reads the Mongoose document first; when the
 * hash is missing there (field absent, or stored under a legacy name that the schema strips),
 * falls back to the raw MongoDB document and migrates a legacy hash to `passwordHash`.
 */
async function resolvePasswordHash(user: { _id: unknown; passwordHash?: unknown }): Promise<string | null> {
  if (typeof user.passwordHash === 'string' && user.passwordHash.length > 0) return user.passwordHash;

  const raw = (await User.collection.findOne({ _id: user._id as never })) as Record<string, unknown> | null;
  if (!raw) return null;

  if (typeof raw.passwordHash === 'string' && raw.passwordHash.length > 0) return raw.passwordHash;

  for (const field of LEGACY_HASH_FIELDS) {
    const candidate = raw[field];
    if (isBcryptHash(candidate)) {
      await User.collection.updateOne({ _id: user._id as never }, { $set: { passwordHash: candidate } });
      return candidate;
    }
  }
  return null;
}

let dummyHash: Promise<string> | null = null;

/** A real hash to check against when the email is unknown, so an unknown email costs the same time as a wrong password. */
function dummyPasswordHash(): Promise<string> {
  if (dummyHash === null) {
    const pending = hashPassword('a-password-nobody-uses-for-timing') as Promise<string>;
    pending.catch(() => {
      if (dummyHash === pending) dummyHash = null;
    });
    dummyHash = pending;
  }
  return dummyHash;
}

async function spendHashTime(password: string): Promise<void> {
  try {
    await verifyPassword(password, await dummyPasswordHash());
  } catch {
    /* timing equalisation is best effort; the 401 is still sent */
  }
}

/**
 * POST /api/users/login. Verifies the credentials and returns a session token.
 *
 * Sprint 4 EP-08.US05.T01 (D-093): failures are counted per account (10 per 15 minutes) and per IP (30 per 15 minutes)
 * on the shared counters; past either limit the answer is 429 with Retry-After, before any password check. A successful
 * login clears the account counter but not the IP counter. Unknown email, wrong password and a suspended or blocked
 * account all get the same 401 text. The token carries the account's tokenVersion.
 *
 * D-097: that throttle is the only lock. The old 8-failure 423 lockout was removed because it answered differently
 * for an existing account; loginAttempts and lockUntil stay on the User model but login no longer reads or writes them.
 * Without a resolvable client address the per-IP bucket is skipped (the account bucket still applies).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, loginRequestSchema);
    if (!body.ok) return body.response;

    const email = body.data.email.toLowerCase();
    const ip = clientAddress(request.headers);
    if (ip !== null) await authLimiter.assertBelow(LOGIN_IP_RULE, ip);
    await authLimiter.assertBelow(LOGIN_ACCOUNT_RULE, email);

    await requireDatabase();

    const failed = async (): Promise<never> => {
      if (ip !== null) await authLimiter.record(LOGIN_IP_RULE, ip);
      await authLimiter.record(LOGIN_ACCOUNT_RULE, email);
      throw new HttpError(401, INVALID_CREDENTIALS);
    };

    const user = await User.findOne({ email })
      .select('+passwordHash name email role store accountStatus tokenVersion emailVerifiedAt')
      .exec();
    if (!user) {
      await spendHashTime(body.data.password);
      return await failed();
    }

    /* patch_login_fix: resolve-password-hash */
    const passwordHash = await resolvePasswordHash(user);
    if (!passwordHash) {
      // No usable hash on this account: treat as invalid credentials (401), never a 500. No email in the log.
      console.error('[seller-backend] login: user ' + String(user._id) + ' has no usable passwordHash in the database.');
      await spendHashTime(body.data.password);
      return await failed();
    }

    const ok = await verifyPassword(body.data.password, passwordHash);
    if (!ok) return await failed();

    // D-093: a suspended or blocked account cannot sign in, and is told nothing more than a wrong password would be.
    const status = (user as { accountStatus?: unknown }).accountStatus;
    if (status === 'suspended' || status === 'blocked') return await failed();

    await authLimiter.reset(LOGIN_ACCOUNT_RULE, email);
    const token = await issueToken(String(user._id), user.role, tokenVersionOf(user as { tokenVersion?: unknown }));
    return Response.json(
      { token, user: { ...sessionUserOf(user), emailVerified: Boolean((user as { emailVerifiedAt?: unknown }).emailVerifiedAt) } },
      { status: 200 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
