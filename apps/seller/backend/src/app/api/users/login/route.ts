import { loginRequestSchema } from '@/lib/contracts';
import { issueToken, requireDatabase, sessionUserOf } from '@/lib/accounts';
import { HttpError, handleRouteError } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { isLocked, recordFailedAttempt, User, verifyPassword } from '@/lib/services';

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

/** POST /api/users/login. Verifies the credentials and the lockout, and returns a session token. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, loginRequestSchema);
    if (!body.ok) return body.response;

    await requireDatabase();

    const user = await User.findOne({ email: body.data.email.toLowerCase() })
      .select('+passwordHash name email role store loginAttempts lockUntil')
      .exec();
    if (!user) throw new HttpError(401, INVALID_CREDENTIALS);

    const now = new Date();
    const state = { loginAttempts: user.loginAttempts, lockUntil: user.lockUntil ?? null };
    if (isLocked(state, now)) {
      throw new HttpError(423, 'Account is temporarily locked. Try again later.');
    }

    /* patch_login_fix: resolve-password-hash */
    const passwordHash = await resolvePasswordHash(user);
    if (!passwordHash) {
      // No usable hash on this account: treat as invalid credentials (401), never a 500.
      console.error(
        '[seller-backend] login: user ' + String(user._id) + ' (' + user.email + ') has no usable passwordHash in the database. ' +
          'Re-create the account (sign up) or reseed it with a bcrypt hash stored in the "passwordHash" field.',
      );
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    const ok = await verifyPassword(body.data.password, passwordHash);
    if (!ok) {
      const next = recordFailedAttempt(state, now);
      await User.updateOne(
        { _id: user._id },
        { $set: { loginAttempts: next.loginAttempts, lockUntil: next.lockUntil } },
      );
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    await User.updateOne({ _id: user._id }, { $set: { loginAttempts: 0, lockUntil: null } });
    const token = await issueToken(String(user._id), user.role);
    return Response.json({ token, user: sessionUserOf(user) }, { status: 200 });
  } catch (err) {
    return handleRouteError(err);
  }
}
