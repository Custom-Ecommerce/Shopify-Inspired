/** Distinct from the seller console's markaz-session, so both consoles can share a domain without colliding. */
export const SESSION_COOKIE = "markaz-admin-session";

/** Matches the 8 hour life of the backend's session token. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

export function sessionCookie(token: string, production: boolean): CookieSpec {
  return { name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: "lax", secure: production, path: "/", maxAge: SESSION_MAX_AGE_SECONDS };
}

export function clearedSessionCookie(production: boolean): CookieSpec {
  return { name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: production, path: "/", maxAge: 0 };
}
