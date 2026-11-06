import { NextRequest, NextResponse } from "next/server";

// The seller backend (port 4001) owns the signup endpoint (apps/seller/backend/src/endpoints/signup.ts).
// The admin backend has no /api/signup route — pointing there was the root cause (RCA §6.1).
const SELLER_BACKEND_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password, name } = body;

  let res: Response;
  try {
    res = await fetch(`${SELLER_BACKEND_API_URL}/api/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[auth/signup] Failed to reach seller-backend:", err);
    return NextResponse.json({ error: "Could not reach the backend. Please try again." }, { status: 502 });
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
  return response;
}

