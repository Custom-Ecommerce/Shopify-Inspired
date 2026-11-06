
import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

export const SESSION_COOKIE_NAME = 'markaz-session';
export const SESSION_TTL = '8h';
export const SESSION_MIN_SECRET_LENGTH = 32;

export const SESSION_COOKIE_OPTIONS = {
httpOnly: true,
secure: process.env.NODE_ENV === 'production',
sameSite: 'lax' as const,
path: '/',
};

export interface SessionClaims extends JWTPayload {
sub: string;
role: string;
aud: string;
}

function keyFor(secret: string): Uint8Array {
if (!secret || secret.length < SESSION_MIN_SECRET_LENGTH) {
throw new Error('Session secret must be at least ' + SESSION_MIN_SECRET_LENGTH + ' characters.');
}
return new TextEncoder().encode(secret);
}

/**
* Signs a session token bound to one backend. The audience claim is mandatory, so a
* token minted for the seller backend is rejected by the admin backend even when both
* are configured with the same secret.
*/
export async function signSession(
claims: { sub: string; role: string },
secret: string,
audience: string,
): Promise<string> {
return new SignJWT({ role: claims.role })
.setProtectedHeader({ alg: 'HS256' })
.setSubject(claims.sub)
.setAudience(audience)
.setIssuedAt()
.setExpirationTime(SESSION_TTL)
.sign(keyFor(secret));
}

/** Verifies signature, pinned algorithm, expiry, and audience. Throws on any failure. */
export async function verifySession(token: string, secret: string, audience: string): Promise<SessionClaims> {
const { payload } = await jwtVerify(token, keyFor(secret), {
algorithms: ['HS256'],
audience,
});
if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
throw new Error('Malformed session token.');
}
return payload as SessionClaims;
}
