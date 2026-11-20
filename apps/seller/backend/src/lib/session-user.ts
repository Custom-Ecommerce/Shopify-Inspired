import mongoose from 'mongoose';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { createSessionGuard, SESSION_USER_FIELDS, toSessionUserRecord, User } from '@/lib/services';

/**
 * Sprint 4 EP-08.US03.T01: the seller backend's session guard (D-093). authenticate() asks it, on every request, whether
 * the account behind a verified token may still be served. Accounts are cached for at most 30 seconds; every account
 * change made here calls forgetSessionUser so this process reacts at once.
 */

type Loader = (userId: string) => Promise<ReturnType<typeof toSessionUserRecord>>;

const databaseLoader: Loader = async (userId) => toSessionUserRecord(await User.findById(userId).select(SESSION_USER_FIELDS).lean());

let loader: Loader = databaseLoader;
let guard = createSessionGuard((id) => loader(id));

/**
 * Whether the guard can read accounts now. Under `next dev` and `next start` (NODE_ENV development or production) it
 * connects first, so the very first request of an instance is checked too, and a database that cannot be reached is a
 * 503. Elsewhere (the unit tests, which stub the connection) it only checks while a connection is already open, so the
 * tests that never stub the User model keep working: this is the test seam, together with setSessionUserLoader.
 */
async function canCheck(): Promise<boolean> {
  if (loader !== databaseLoader) return true;
  const env = process.env.NODE_ENV;
  if (env === 'production' || env === 'development') {
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
  }
  return mongoose.connection.readyState === 1;
}

/** The account behind the token, or null when it could not be checked (see canCheck). Throws SessionRejectedError. */
export async function checkSellerSession(claims: { sub: string; role: string; tv?: unknown }): Promise<ReturnType<typeof toSessionUserRecord>> {
  if (!(await canCheck())) return null;
  return guard.check(claims);
}

/** Call after every change to an account (password, status, email, revoke). */
export function forgetSessionUser(userId: string): void {
  guard.forget(userId);
}

/** Test seam: read accounts from a stub instead of the database. Pass null to go back to the database. */
export function setSessionUserLoader(next: Loader | null, options: { ttlMs?: number } = {}): void {
  loader = next ?? databaseLoader;
  guard = createSessionGuard((id) => loader(id), options);
}
