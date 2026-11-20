import { NextResponse } from "next/server";

/**
 * Sprint 4 EP-08: sets the session cookie the same way /api/auth/login does. Used when the backend hands THIS session a
 * fresh token (a password change, "sign out of all other devices"), so the seller stays signed in.
 */
export function withSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set("markaz-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  return response;
}

/** The proxy responseHandler for routes that answer { token }: the token goes into the cookie, never to the page. */
export function tokenToCookie(_res: Response, data: unknown): NextResponse {
  const token = typeof (data as { token?: unknown } | null)?.token === "string" ? (data as { token: string }).token : null;
  const response = NextResponse.json({ ok: true });
  return token ? withSessionCookie(response, token) : response;
}
