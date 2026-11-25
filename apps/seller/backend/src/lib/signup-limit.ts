import { createHash } from 'node:crypto';
import { clientAddress, PORTAL_CLIENT_SCOPE } from '@/lib/account-support';
import { RateLimitedError } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { enforceRateLimitFor, SIGNUP_ADDRESS_LIMIT, SIGNUP_EMAIL_LIMIT } from '@/lib/storefront/rate-limit';

/**
 * SB-F1: the limits of POST /api/signup, on the same MongoDB fixed windows as the contact form and the analytics events. Per client address (the one the
 * portal signed, else the trusted-proxy rule) and per email. An address that cannot be known is not counted, as on login: never one bucket shared by
 * everybody (D-097); the email limit still applies. The email is hashed before it names a counter. Throws RateLimitedError, so the answer is the same
 * 429 with Retry-After as the other account routes.
 */
export async function enforceSignupLimits(headers: Headers, email: string): Promise<void> {
  try {
    const address = clientAddress(headers);
    if (address !== null) await enforceRateLimitFor(SIGNUP_ADDRESS_LIMIT, PORTAL_CLIENT_SCOPE, address);
    await enforceRateLimitFor(SIGNUP_EMAIL_LIMIT, PORTAL_CLIENT_SCOPE, createHash('sha256').update(email).digest('hex'));
  } catch (err) {
    if (err instanceof StorefrontHttpError && err.status === 429) throw new RateLimitedError(Number(err.extra.retryAfterSeconds));
    throw err;
  }
}
