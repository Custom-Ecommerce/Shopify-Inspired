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

/** Mints a session token for the seller backend. */
export async function issueToken(userId: string, role: string): Promise<string> {
  return signSession({ sub: userId, role }, requireSellerSecret(), SELLER_AUDIENCE);
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
