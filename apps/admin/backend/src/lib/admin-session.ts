import { AdminHttpError, authenticateAdmin, requireDatabase } from '@/lib/admin-auth';
import { PolicyDeniedError, SESSION_USER_FIELDS, SessionRejectedError, toSessionUserRecord, User } from '@/lib/workspace';

/**
 * The gate for every session-facing admin route. Verifies the token (signature, expiry, audience), then reads the
 * account again so a deleted or demoted operator stops working at once.
 *
 * Sprint 4 EP-08 (D-093): the same read also refuses a suspended or blocked account (401 ACCOUNT_SUSPENDED) and a token
 * from before the last password reset (401 SESSION_REVOKED: the token's tv is older than the account's tokenVersion).
 * The admin side reads the account on every request with no cache: operator traffic is small, so the strictest form of
 * the "at most 30 seconds" rule costs nothing, and a change is seen at once without clearing anything.
 */
export async function authorizeAdmin(request: Request): Promise<{ userId: string; tokenVersion: number }> {
  const { userId, tokenVersion } = await authenticateAdmin(request);
  await requireDatabase();
  const user = toSessionUserRecord(await User.findById(userId).select(SESSION_USER_FIELDS).lean());
  if (!user || user.role !== 'admin') throw new AdminHttpError(401, 'Invalid or expired session');
  if (user.accountStatus !== 'active') throw new SessionRejectedError('ACCOUNT_SUSPENDED');
  if (user.tokenVersion !== tokenVersion) throw new SessionRejectedError('SESSION_REVOKED');
  return { userId, tokenVersion };
}

/** Runs a policy check and turns a denial into a 403, so no route answers with a stack trace. */
export function requirePolicy(check: () => void): void {
  try {
    check();
  } catch (err) {
    if (err instanceof PolicyDeniedError) throw new AdminHttpError(403, 'Forbidden');
    throw err;
  }
}

export const NO_STORE = { 'Cache-Control': 'no-store' };
