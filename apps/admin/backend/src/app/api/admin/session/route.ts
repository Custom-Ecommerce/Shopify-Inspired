import { AdminHttpError, dummyPasswordHash, errorResponse, issueAdminToken, parseLogin, requireAdminSecret, requireDatabase, sessionUserOf } from '@/lib/admin-auth';
import { User, isLocked, recordFailedAttempt, verifyPassword } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVALID_CREDENTIALS = 'Invalid email or password';
const MAX_LOGIN_BODY_BYTES = 8 * 1024;
const MAX_LOCKOUT_RETRIES = 5;

/**
 * Password check that never throws. A missing or empty hash is simply "no match", and so is any error from the
 * hashing library (for example bcrypt's "Illegal arguments: string, undefined"). The caller then answers 401
 * instead of crashing the route.
 */
async function checkPassword(password: string, hash: unknown): Promise<boolean> {
  if (typeof hash !== 'string' || hash.length === 0) return false;
  try {
    return Boolean(await verifyPassword(password, hash));
  } catch (err) {
    console.error('admin session: password check failed:', err instanceof Error ? err.message : 'unknown error');
    return false;
  }
}

/** Spends the same hash work as a real check when the email is unknown. Best effort: it cannot throw. */
async function equalizeTiming(password: string): Promise<void> {
  try {
    await checkPassword(password, await dummyPasswordHash());
  } catch {
    /* timing equalisation is optional; the 401 must still be sent */
  }
}

interface LockState {
  loginAttempts: number;
  lockUntil: Date | null;
}

/**
 * Records a failed sign-in with compare-and-swap. The write only lands if the counter is still what this request
 * read, so parallel guesses cannot all overwrite each other with the same "1" and dodge the lockout. A lost race
 * re-reads and recomputes.
 */
async function recordFailureAtomically(id: unknown, initial: LockState, now: Date): Promise<void> {
  let state = initial;
  for (let round = 0; round < MAX_LOCKOUT_RETRIES; round += 1) {
    const next = recordFailedAttempt(state, now);
    const result = await User.updateOne(
      { _id: id, loginAttempts: state.loginAttempts, lockUntil: state.lockUntil },
      { $set: { loginAttempts: next.loginAttempts, lockUntil: next.lockUntil } },
    );
    if (result.matchedCount !== 0) return;
    const fresh = await User.findById(id).select('loginAttempts lockUntil').lean();
    if (!fresh) return;
    state = { loginAttempts: fresh.loginAttempts ?? 0, lockUntil: fresh.lockUntil ?? null };
    if (isLocked(state, now)) return;
  }
}

/**
 * POST /api/admin/session. Signs an operator in and returns a session token (audience admin-backend).
 * Unknown emails and non-admin accounts get the same 401 as a wrong password, after the same hash work.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    let raw: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_LOGIN_BODY_BYTES) throw new AdminHttpError(413, 'Request body too large');
      raw = JSON.parse(text);
    } catch (err) {
      if (err instanceof AdminHttpError) throw err;
      throw new AdminHttpError(400, 'Body must be JSON');
    }
    const input = parseLogin(raw);
    if (!input.ok) {
      return Response.json({ error: 'Invalid request', issues: input.issues }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    }

    requireAdminSecret();
    await requireDatabase();

    const email = input.data.email.toLowerCase();
    const user = await User.findOne({ email }).select('+passwordHash name email role store loginAttempts lockUntil').exec();
    if (!user || user.role !== 'admin' || typeof user.passwordHash !== 'string' || user.passwordHash.length === 0) {
      await equalizeTiming(input.data.password);
      throw new AdminHttpError(401, INVALID_CREDENTIALS);
    }

    const now = new Date();
    const state = { loginAttempts: user.loginAttempts, lockUntil: user.lockUntil ?? null };
    if (isLocked(state, now)) throw new AdminHttpError(423, 'Account is temporarily locked. Try again later.');

    const ok = await checkPassword(input.data.password, user.passwordHash);
    if (!ok) {
      await recordFailureAtomically(user._id, state, now);
      throw new AdminHttpError(401, INVALID_CREDENTIALS);
    }

    await User.updateOne({ _id: user._id }, { $set: { loginAttempts: 0, lockUntil: null } });
    const token = await issueAdminToken(String(user._id));
    return Response.json({ token, user: sessionUserOf(user) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
