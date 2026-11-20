import { connectSellerDb } from '@/lib/mongo';
import { HttpError } from '@/lib/http';
import { SESSION_MIN_SECRET_LENGTH, signSession } from '@/lib/services';

/** Must equal SELLER_SESSION_AUDIENCE in lib/auth.ts. Tokens are bound to this backend. */
export const SELLER_AUDIENCE = 'seller-backend';

/** Returns the session secret, or 503 when authentication is not configured. */
export function requireSellerSecret(): string {
  const secret = process.env.SELLER_AUTH_SECRET;
  if (secret === undefined || secret.length < SESSION_MIN_SECRET_LENGTH) {
    throw new HttpError(503, 'Authentication is not configured');
  }
  return secret;
}

/** Connects to the seller database, or 503 when it is unavailable. */
export async function requireDatabase(): Promise<void> {
  try {
    await connectSellerDb();
  } catch {
    throw new HttpError(503, 'Seller database is unavailable');
  }
}

/**
 * Mints a session token for the seller backend. tokenVersion is the account's current one (Sprint 4 EP-08): a token
 * with an older version is refused by authenticate(). Missing means 0, as for accounts from before.
 */
export async function issueToken(userId: string, role: string, tokenVersion: number = 0): Promise<string> {
  return signSession({ sub: userId, role, tv: tokenVersion }, requireSellerSecret(), SELLER_AUDIENCE);
}

/** A stored tokenVersion read leniently (missing or bad means 0). */
export function tokenVersionOf(user: { tokenVersion?: unknown } | null | undefined): number {
  const tv = user?.tokenVersion;
  return typeof tv === 'number' && Number.isInteger(tv) && tv >= 0 ? tv : 0;
}

/** The session user, in the shape /api/users/me returns (id, not _id; no secret fields). */
export function sessionUserOf(user: {
  _id: unknown;
  name: string;
  email: string;
  role: string;
  store?: unknown;
}): { id: string; name: string; email: string; role: 'admin' | 'seller'; store: string | null } {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as 'admin' | 'seller',
    store: user.store ? String(user.store) : null,
  };
}
