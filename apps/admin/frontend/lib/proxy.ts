import { clientAddressHeaders } from "@/lib/client-address";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backendFetch, BackendUnavailableError } from "@/lib/backend";
import { SESSION_COOKIE, clearedSessionCookie } from "@/lib/cookie";

const NO_STORE = { "Cache-Control": "no-store" };

/** Statuses the backend uses for answers the console shows as they are. Any other failure becomes a 502. */
const PASS_THROUGH = [400, 403, 404, 409, 422, 429, 503];

/** The audited write failures the backend reports as a 500 with a message the operator must see (a rollback that did or did not work). */
const RECORDED_FAILURE = /^The [a-z ]+ could not be (recorded|restored)/;

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export function isObjectId(value: string): boolean {
  return OBJECT_ID.test(value);
}

/**
 * A browser always sends Origin on a cross-site POST. When it is present it must be this site, so a form on another
 * origin cannot ride the SameSite cookie. Requests without Origin (not from a browser page) are let through: they
 * still need the cookie.
 */
export function isSameOrigin(request: { headers: Headers; url: string }): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

export interface ProxyInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: string;
}

/**
 * Forwards one call to the admin backend with the operator's session. The cookie becomes a bearer token on the
 * server side only. A session the backend refuses clears the cookie. The browser never sees the backend address.
 */
export async function proxyToBackend(request: NextRequest, path: string, init: ProxyInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  if (method !== "GET" && !isSameOrigin(request)) return fail(403, "Cross-site request refused");

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return fail(401, "Authentication required");

  let upstream: Response;
  try {
    // Sprint 4 A3: the operator's address, signed, for the backend's per-IP limits.
    const headers: Record<string, string> = { authorization: "Bearer " + token, ...clientAddressHeaders(request.headers) };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    upstream = await backendFetch(path, { method, headers, body: init.body });
  } catch (err) {
    return fail(503, err instanceof BackendUnavailableError ? err.message : "The admin backend is unavailable");
  }

  if (upstream.status === 401) {
    const response = fail(401, "Invalid or expired session");
    response.cookies.set(clearedSessionCookie(process.env.NODE_ENV === "production"));
    return response;
  }

  const payload = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  if (upstream.ok) {
    if (payload === null) return fail(502, "Unexpected response from the admin backend");
    return NextResponse.json(payload, { status: 200, headers: NO_STORE });
  }
  const error = typeof payload?.error === "string" ? payload.error : "The admin backend could not complete the request";
  const status = PASS_THROUGH.includes(upstream.status) || (upstream.status === 500 && RECORDED_FAILURE.test(error)) ? upstream.status : 502;
  return fail(status, error, Array.isArray(payload?.issues) ? { issues: payload.issues } : {});
}

/**
 * Forwards a list call to the backend, passing on only the named query parameters. Anything else in the URL is
 * dropped, so the browser cannot add filters the backend did not ask for.
 */
export async function proxyList(request: NextRequest, path: string, allowed: readonly string[]): Promise<Response> {
  const forwarded = new URLSearchParams();
  for (const name of allowed) {
    const value = request.nextUrl.searchParams.get(name);
    if (value !== null && value !== "") forwarded.set(name, value);
  }
  const query = forwarded.toString();
  return proxyToBackend(request, path + (query === "" ? "" : "?" + query));
}
