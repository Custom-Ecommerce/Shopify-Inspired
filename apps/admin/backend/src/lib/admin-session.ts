import { AdminHttpError, authenticateAdmin, requireDatabase } from '@/lib/admin-auth';
import { PolicyDeniedError, User } from '@/lib/workspace';

/**
 * The gate for every session-facing admin route. Verifies the token (signature, expiry, audience), then reads the
 * account again so a deleted or demoted operator stops working at once.
 */
export async function authorizeAdmin(request: Request): Promise<{ userId: string }> {
  const { userId } = await authenticateAdmin(request);
  await requireDatabase();
  const user = await User.findById(userId).select('role').lean();
  if (!user || user.role !== 'admin') throw new AdminHttpError(401, 'Invalid or expired session');
  return { userId };
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
