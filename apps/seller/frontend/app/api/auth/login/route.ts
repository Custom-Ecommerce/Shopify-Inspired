import { NextRequest, NextResponse } from "next/server";
import { clientAddressHeaders } from "@/lib/client-address";

const PAYLOAD_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";

/**
 * Phase 7.3 — POST /api/auth/login
 *
 * Forwards credentials to Payload's built-in `POST /api/users/login`
 * (auto-exposed by the `auth: {...}` block on the Users collection — not
 * gated by `Users.access.create`, so this works for any existing
 * seller account without needing the signup endpoint's
 * overrideAccess trick). On success, sets the JWT as an httpOnly cookie —
 * same `markaz-session` name the existing `/api/account/domain/*` proxies
 * already read (see those files) — so this alone is enough to make every
 * already-cookie-aware proxy in the app start working, no changes needed
 * there.
 *
 * Phase 1 (Microservices) — now targets the Seller Backend (port 4001)
 * instead of the Admin Backend (port 4000).
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${PAYLOAD_API_URL}/api/users/login`, {
      method: "POST",
      // Sprint 4 A3: the browser's address, signed, so the login limit per IP sees the shopper and not this server.
      headers: { "Content-Type": "application/json", ...clientAddressHeaders(req.headers) },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[auth/login] Failed to reach seller-backend:", err);
    return NextResponse.json({ error: "Could not reach the backend. Please try again." }, { status: 502 });
  }

  if (!res.ok) {
    if (res.status === 401) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    if (res.status === 500 || res.status === 502 || res.status === 503) {
      return NextResponse.json({ error: "Backend unreachable. Please try again later." }, { status: 502 });
    }
    // Unexpected upstream status — surface the upstream message if available.
    let upstreamMsg: string | undefined;
    try {
      const errData = await res.json();
      upstreamMsg = errData?.message || errData?.error;
    } catch { /* non-JSON body */ }
    return NextResponse.json(
      { error: upstreamMsg || "Login failed. Please try again." },
      { status: res.status }
    );
  }

  const data = await res.json();
  const token = data?.token as string | undefined;
  if (!token || !data?.user) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const response = NextResponse.json({ user: data.user });
  response.cookies.set("markaz-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: data.exp ? data.exp - Math.floor(Date.now() / 1000) : 60 * 60 * 8,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  return response;
}
