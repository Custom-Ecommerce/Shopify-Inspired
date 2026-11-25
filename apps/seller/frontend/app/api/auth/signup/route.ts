import { NextRequest, NextResponse } from "next/server";
import { normalizeReferralCode } from "@markaz/contracts/referral";
import { clientAddressHeaders } from "@/lib/client-address";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";

// The seller backend (port 4001) owns the signup endpoint (apps/seller/backend/src/endpoints/signup.ts).
// The admin backend has no /api/signup route — pointing there was the root cause (RCA §6.1).
const SELLER_BACKEND_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; name?: unknown; ref?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password, name } = body;
  // S8-B5: the code the page sent, else the remembered one. Only a well-formed code is forwarded.
  const ref = normalizeReferralCode(body.ref) ?? normalizeReferralCode(req.cookies.get(REFERRAL_COOKIE)?.value);

  let res: Response;
  try {
    res = await fetch(`${SELLER_BACKEND_API_URL}/api/signup`, {
      method: "POST",
      // SB-F1: the browser's address, signed, so the signup limit per address sees the visitor and not this server.
      headers: { "Content-Type": "application/json", ...clientAddressHeaders(req.headers) },
      body: JSON.stringify({ email, password, name, ...(ref === null ? {} : { ref }) }),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[auth/signup] Failed to reach seller-backend:", err);
    return NextResponse.json({ error: "Could not reach the backend. Please try again." }, { status: 502 });
  }

  // SB-F1: the throttle's 429 and its Retry-After reach the page, which says how long to wait.
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    return NextResponse.json(
      { error: "Too many attempts. Please wait and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { ...(retryAfter ? { "Retry-After": retryAfter } : {}), "Cache-Control": "no-store" } },
    );
  }

  const data = await res.json();

  if (!res.ok || !data.success) {
    return NextResponse.json({ error: data.error || data.message || "Signup failed." }, { status: res.status });
  }

  // Seller backend returns { success, user, token } — no storeSlug in the response body.
  const token = data?.token as string | undefined;
  if (!token) {
    return NextResponse.json({ error: "Signup succeeded but no token returned." }, { status: 500 });
  }

  const response = NextResponse.json({ success: true, user: data.user });
  response.cookies.set("markaz-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  // S8-B5: signup is complete, so the remembered code is spent. The page set it for this host only (no domain).
  response.cookies.set(REFERRAL_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return response;
}

