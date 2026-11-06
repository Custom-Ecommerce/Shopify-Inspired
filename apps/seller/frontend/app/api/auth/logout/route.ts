import { NextRequest, NextResponse } from "next/server";

/**
 * POST|GET /api/auth/logout — clears the `markaz-session` session cookie and sends the browser to
 * `/login` (303, so a POST becomes a GET of the login page). The cookie is cleared with the same
 * attributes it was set with (path, optional `COOKIE_DOMAIN`), otherwise browsers keep it.
 */
function logout(req: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/login", req.url), 303);
  response.cookies.set("markaz-session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  return response;
}

export function POST(req: NextRequest): NextResponse {
  return logout(req);
}

export function GET(req: NextRequest): NextResponse {
  return logout(req);
}
