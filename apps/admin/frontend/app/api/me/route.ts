import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, clearedSessionCookie } from "@/lib/cookie";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/me. The signed-in operator, from the cookie. A session the backend refuses also clears the cookie. */
export async function GET(request: NextRequest): Promise<Response> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: NO_STORE });

  const session = await readSession(token);
  if (session.status === "ok") return NextResponse.json({ user: session.user }, { headers: NO_STORE });
  if (session.status === "unavailable") {
    return NextResponse.json({ error: "The admin backend is unavailable" }, { status: 503, headers: NO_STORE });
  }
  const response = NextResponse.json({ error: "Invalid or expired session" }, { status: 401, headers: NO_STORE });
  response.cookies.set(clearedSessionCookie(process.env.NODE_ENV === "production"));
  return response;
}
