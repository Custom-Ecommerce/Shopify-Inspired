import { NextResponse } from "next/server";
import { backendFetch, BackendUnavailableError } from "@/lib/backend";
import { authResponseSchema, loginRequestSchema } from "@/lib/contracts";
import { clearedSessionCookie, sessionCookie } from "@/lib/cookie";
import { isSameOrigin } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const PASS_THROUGH = [401, 422, 423, 429, 503];

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * POST /api/session. Signs in through the admin backend. The token goes into an HttpOnly cookie and is never sent to
 * the browser in a response body.
 */
export async function POST(request: Request): Promise<Response> {
  // POST_CROSS_SITE: a form on another origin must not be able to sign an operator in to an attacker's account.
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403, headers: NO_STORE });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = loginRequestSchema.safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }

  let upstream: Response;
  try {
    upstream = await backendFetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.data),
    });
  } catch (err) {
    const message = err instanceof BackendUnavailableError ? err.message : "The admin backend is unavailable";
    return NextResponse.json({ error: message }, { status: 503, headers: NO_STORE });
  }

  if (!upstream.ok) {
    const payload = (await upstream.json().catch(() => null)) as { error?: unknown } | null;
    const error = typeof payload?.error === "string" ? payload.error : "Sign-in failed";
    const status = PASS_THROUGH.includes(upstream.status) ? upstream.status : 502;
    return NextResponse.json({ error }, { status, headers: NO_STORE });
  }

  const parsed = authResponseSchema.safeParse(await upstream.json().catch(() => null));
  if (!parsed.success || parsed.data.user.role !== "admin") {
    return NextResponse.json({ error: "Unexpected response from the admin backend" }, { status: 502, headers: NO_STORE });
  }
  const response = NextResponse.json({ user: parsed.data.user }, { headers: NO_STORE });
  response.cookies.set(sessionCookie(parsed.data.token, isProduction()));
  return response;
}

/** DELETE /api/session. Signs out by clearing the cookie. The token itself is stateless and expires on its own. */
export async function DELETE(request: Request): Promise<Response> {
  // DELETE_CROSS_SITE: another origin must not be able to sign the operator out.
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403, headers: NO_STORE });
  const response = new NextResponse(null, { status: 204, headers: NO_STORE });
  response.cookies.set(clearedSessionCookie(isProduction()));
  return response;
}
