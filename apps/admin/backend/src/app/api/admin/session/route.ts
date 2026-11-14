import { AdminHttpError, dummyPasswordHash, errorResponse, issueAdminToken, parseLogin, requireAdminSecret, requireDatabase, sessionUserOf } from '@/lib/admin-auth';
import { User, LOGIN_ACCOUNT_RULE, LOGIN_IP_RULE, isLocked, recordFailedAttempt, verifyPassword } from '@/lib/workspace';
import { adminAuthLimiter, clientAddress } from '@/lib/admin-account';

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
 *
 * Sprint 4 EP-08.US05.T01 (D-093): failures are also counted per account (10 per 15 minutes) and per IP (30 per 15
 * minutes) on the shared counters; past either limit the answer is 429 with Retry-After, before any password check. A
 * successful login clears the account counter, not the IP counter. A suspended or blocked operator gets the same 401.
 * The token carries the account's tokenVersion.
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

    const email = input.data.email.toLowerCase();
    const ip = clientAddress(request.headers);
    await adminAuthLimiter.assertBelow(LOGIN_IP_RULE, ip);
    await adminAuthLimiter.assertBelow(LOGIN_ACCOUNT_RULE, email);
    const failed = async (): Promise<never> => {
      await adminAuthLimiter.record(LOGIN_IP_RULE, ip);
      await adminAuthLimiter.record(LOGIN_ACCOUNT_RULE, email);
      throw new AdminHttpError(401, INVALID_CREDENTIALS);
    };

    await requireDatabase();

    const user = await User.findOne({ email }).select('+passwordHash name email role store loginAttempts lockUntil accountStatus tokenVersion').exec();
    if (!user || user.role !== 'admin' || typeof user.passwordHash !== 'string' || user.passwordHash.length === 0) {
      await equalizeTiming(input.data.password);
      return await failed();
    }

    const now = new Date();
    const state = { loginAttempts: user.loginAttempts, lockUntil: user.lockUntil ?? null };
    if (isLocked(state, now)) throw new AdminHttpError(423, 'Account is temporarily locked. Try again later.');

    const ok = await checkPassword(input.data.password, user.passwordHash);
    if (!ok) {
      await recordFailureAtomically(user._id, state, now);
      return await failed();
    }

    const status = (user as { accountStatus?: unknown }).accountStatus;
    if (status === 'suspended' || status === 'blocked') return await failed();

    await User.updateOne({ _id: user._id }, { $set: { loginAttempts: 0, lockUntil: null } });
    await adminAuthLimiter.reset(LOGIN_ACCOUNT_RULE, email);
    const tv = (user as { tokenVersion?: unknown }).tokenVersion;
    const token = await issueAdminToken(String(user._id), typeof tv === 'number' && Number.isInteger(tv) && tv > 0 ? tv : 0);
    return Response.json({ token, user: sessionUserOf(user) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
