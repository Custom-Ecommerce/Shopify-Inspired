import { AdminHttpError, authenticateAdmin, requireDatabase } from '@/lib/admin-auth';
import type { AdminCapability, AdminLevel } from '../../../../../packages/auth/src/admin-levels';
import { PolicyDeniedError, SESSION_USER_FIELDS, SessionRejectedError, adminCan, effectiveAdminLevel, toSessionUserRecord, User } from '@/lib/workspace';

/** The capability of a route that any signed-in admin may use whatever the level (the console's own session check). Only the routes listed in the guard test use it. */
export const ANY_ADMIN = 'any-admin' as const;

/**
 * The gate for every session-facing admin route. Verifies the token (signature, expiry, audience), then reads the
 * account again so a deleted or demoted operator stops working at once.
 *
 * Sprint 4 EP-08 (D-093): the same read also refuses a suspended or blocked account (401 ACCOUNT_SUSPENDED) and a token
 * from before the last password reset (401 SESSION_REVOKED: the token's tv is older than the account's tokenVersion).
 * The admin side reads the account on every request with no cache: operator traffic is small, so the strictest form of
 * the "at most 30 seconds" rule costs nothing, and a change is seen at once without clearing anything.
 */
export async function authorizeAdmin(request: Request, capability: AdminCapability | typeof ANY_ADMIN): Promise<{ userId: string; tokenVersion: number; adminLevel: AdminLevel }> {
  const { userId, tokenVersion } = await authenticateAdmin(request);
  await requireDatabase();
  const doc = (await User.findById(userId)
    .select(SESSION_USER_FIELDS + ' adminLevel')
    .lean()) as unknown as { adminLevel?: unknown } | null;
  const user = toSessionUserRecord(doc);
  if (!user || user.role !== 'admin') throw new AdminHttpError(401, 'Invalid or expired session');
  if (user.accountStatus !== 'active') throw new SessionRejectedError('ACCOUNT_SUSPENDED');
  if (user.tokenVersion !== tokenVersion) throw new SessionRejectedError('SESSION_REVOKED');
  // Sprint 6 (S6-B6, D-118): the level is read from the same account read as everything else, on EVERY request (no cache), so a level change or a disable is
  // seen on the next request. An admin with no level is an owner (back-compat). A capability the level lacks is a 403.
  const adminLevel = effectiveAdminLevel(doc?.adminLevel);
  if (capability !== ANY_ADMIN && !adminCan(adminLevel, capability)) throw new AdminHttpError(403, 'Forbidden', 'CAPABILITY_REQUIRED');
  return { userId, tokenVersion, adminLevel };
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
