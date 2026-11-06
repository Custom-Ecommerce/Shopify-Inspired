/**
 * Proxies a Next.js App Router API request to the Seller (Payload) backend.
 *
 * Phase 6A (Blueprint §6.4) — multi-store aware:
 *  - ordered store-resolution (`x-store-id` → legacy `?storeId=` → implicit default),
 *    always verified against `user.stores` (never against a client claim);
 *  - upstream gets `Authorization: JWT <token>`, `x-store-id` and `x-request-id`;
 *  - client-supplied `storeId` / `where[store]…` query keys are stripped;
 *  - writes always carry `body.store = auth.storeId`;
 *  - every error leaves as `{ error, code, details? }`.
 *
 * No `role` branches, no owner-query fallbacks.
 */

import { NextRequest, NextResponse } from "next/server";

import { extractStoreIds, getDashboardUser, isImplicitDefaultEnabled } from "@/lib/dashboard-auth";
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from "@/lib/error-codes";

import type { DashboardUser } from "@/lib/types/dashboard";

export const PAYLOAD_API_URL = (process.env.SELLER_BACKEND_API_URL || "http://localhost:4001").replace(/\/$/, "");

export interface ProxyAuthResult {
  token?: string;
  user?: DashboardUser | null;
  /** The verified active store (set only when `storeScope` ≠ "none" and one was resolved). */
  storeId?: string;
  /** Ids of every store the user owns (from `user.stores`). */
  stores?: string[];
}

/** `admin` / `seller` were removed (§6.4): there are no role-differentiated users. */
export type AuthRequirement = "none" | "token" | "dashboard" | "customer";

/** Replaces the old boolean `requireStore`. Default for `dashboard` routes: `"required"`. */
export type StoreScope = "required" | "optional" | "none";

export type ProxyMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

export interface ProxyOptions {
  /** Destination path on the Seller backend (e.g. "/api/products" or a function of the request/auth). */
  path: string | ((req: NextRequest, auth: ProxyAuthResult) => string);
  /** HTTP method for the upstream request. Defaults to req.method or GET. */
  method?: ProxyMethod;
  /**
   * - "none":      public endpoint, no auth.
   * - "token":     cookie must be present; token forwarded; NO store resolution.
   * - "dashboard": authenticated seller + store resolution (default).
   * - "customer":  `customer-token` cookie must be present.
   */
  auth?: AuthRequirement;
  /**
   * Only for `auth: "dashboard"`. "required" (default) → 403/400 unless a store
   * is resolved; "optional" → resolve if present; "none" → skip resolution.
   */
  storeScope?: StoreScope;
  /** Override cookie name (defaults to "markaz-session", or "customer-token" for auth="customer"). */
  cookieName?: string;
  /** Authorization prefix: "JWT" (default) or "Bearer" (default for customer). */
  authHeaderPrefix?: "JWT" | "Bearer";
  /** Query parameters merged into the upstream URL (applied AFTER client store keys are stripped). */
  params?:
    | URLSearchParams
    | Record<string, string | number | boolean | undefined>
    | ((params: URLSearchParams, auth: ProxyAuthResult) => void);
  /** Custom upstream body, or a transformer of the incoming JSON body. */
  body?: unknown | ((incomingBody: unknown, auth: ProxyAuthResult) => unknown | Promise<unknown>);
  /**
   * Set `body.store = auth.storeId` on POST/PATCH/PUT (default: true). Opt out
   * ONLY for endpoints that are not store-owned collections (e.g. PATCH of the
   * Stores document itself, `/api/stores/:id/broadcast`).
   */
  bindStore?: boolean;
  /** Runs after auth + store resolution; return a response to short-circuit. */
  guard?: (req: NextRequest, auth: ProxyAuthResult) => NextResponse | null | Promise<NextResponse | null>;
  /** Transform a SUCCESSFUL (2xx) upstream JSON response. Errors are always normalised by the proxy. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseHandler?: (res: Response, data: any) => Promise<NextResponse> | NextResponse;
  /** Custom handler when the upstream fetch itself fails (network error). */
  onError?: (err: unknown) => Promise<NextResponse> | NextResponse;
  /** Adds `success: false` to error bodies (customer routes always do). */
  errorEnvelope?: boolean;
  /** Extra upstream request headers. */
  headers?: Record<string, string>;
  /** fetch cache mode. Defaults to "no-store". */
  cache?: RequestCache;
  /** Log tag prefix. */
  logScope?: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Builds a `{ error, code, details? }` response (plus `success:false` when enveloped). */
export function apiError(
  status: number,
  code: ErrorCode | string,
  error: string,
  opts: { details?: unknown; envelope?: boolean; requestId?: string } = {}
): NextResponse {
  const body: ApiErrorBody & { success?: false } = { error, code };
  if (opts.details !== undefined) body.details = opts.details;
  if (opts.envelope) body.success = false;
  return NextResponse.json(body, {
    status,
    headers: opts.requestId ? { "x-request-id": opts.requestId } : undefined,
  });
}

function codeError(code: ErrorCode, error: string, envelope = false): NextResponse {
  return apiError(ERROR_STATUS[code], code, error, { envelope });
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHENTICATED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 422: return "VALIDATION_ERROR";
    case 502:
    case 503:
    case 504: return "BACKEND_OFFLINE";
    default: return "UPSTREAM_ERROR";
  }
}

/**
 * Upstream non-2xx → `{ error, code, details? }`. Preserves Payload's
 * `errors[].data.code` when present; never forwards stack traces.
 */
async function normalizeUpstreamError(
  res: Response,
  isJson: boolean,
  envelope: boolean,
  requestId: string
): Promise<NextResponse> {
  let data: unknown = null;
  if (isJson) {
    data = await res.json().catch(() => null);
  } else {
    await res.text().catch(() => "");
  }
  const rec = isRecord(data) ? data : {};
  const errors = Array.isArray(rec.errors) ? rec.errors : undefined;
  const first = errors && isRecord(errors[0]) ? errors[0] : undefined;
  const firstData = first && isRecord(first.data) ? first.data : undefined;

  const code = str(rec.code) ?? str(firstData?.code) ?? str(first?.code) ?? defaultCodeForStatus(res.status);
  const message =
    str(rec.error) ?? str(rec.message) ?? str(first?.message) ?? `Request failed with status ${res.status}.`;
  const details = rec.details ?? errors;

  return apiError(res.status, code, message, { details, envelope, requestId });
}

/**
 * Throw from a `body` transformer to abort the proxy call with a specific
 * response (e.g. a 400 FIELD_NOT_ALLOWED) instead of forwarding upstream.
 */
export class ProxyResponseError extends Error {
  readonly response: NextResponse;
  constructor(response: NextResponse) {
    super("ProxyResponseError");
    this.name = "ProxyResponseError";
    this.response = response;
  }
}

// ── store resolution ─────────────────────────────────────────────────────────

/** Legacy `?storeId=` is honoured for same-origin requests only. */
function isSameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

/**
 * Resolves session auth (and, for `dashboard`, the active store) per the
 * ordered algorithm in Blueprint §6.4:
 *
 *  1. token present? no → 401 UNAUTHENTICATED; fetch user (offline → 502, invalid → 401)
 *  2. requested = header `x-store-id` → else query `storeId` (legacy, same-origin) → none
 *  3. owned = ids in `user.stores`
 *  4. requested ∉ owned → 403 STORE_FORBIDDEN (existence is never revealed)
 *  5. requested absent & scope=required: flag on && exactly one owned → use it; else 400 STORE_CONTEXT_REQUIRED
 *  6. set `auth.storeId` and expose `auth.stores`
 */
export async function resolveDashboardAuth(
  req: NextRequest,
  requirement: AuthRequirement = "dashboard",
  opts: { cookieName?: string; storeScope?: StoreScope; envelope?: boolean } = {}
): Promise<{ auth: ProxyAuthResult; errorResponse?: NextResponse }> {
  if (requirement === "none") return { auth: {} };

  const envelope = opts.envelope ?? requirement === "customer";
  const cookieName = opts.cookieName || (requirement === "customer" ? "customer-token" : "markaz-session");
  const token = req.cookies.get(cookieName)?.value;

  // 1. token
  if (!token) {
    return { auth: {}, errorResponse: codeError("UNAUTHENTICATED", "Not authenticated.", envelope) };
  }
  if (requirement === "token" || requirement === "customer") return { auth: { token } };

  let user: DashboardUser | null;
  try {
    user = await getDashboardUser(token);
  } catch {
    return { auth: { token }, errorResponse: codeError("BACKEND_OFFLINE", "Could not reach the backend. Please try again.", envelope) };
  }
  if (!user) {
    return { auth: { token }, errorResponse: codeError("UNAUTHENTICATED", "Not authenticated.", envelope) };
  }

  // 3. owned
  const owned = extractStoreIds(user);
  const scope: StoreScope = opts.storeScope ?? "required";
  if (scope === "none") return { auth: { token, user, stores: owned } };

  // 2. requested
  const fromHeader = req.headers.get("x-store-id")?.trim() || undefined;
  const fromQuery = isSameOrigin(req) ? req.nextUrl.searchParams.get("storeId")?.trim() || undefined : undefined;
  const requested = fromHeader ?? fromQuery;

  // 4. membership
  if (requested !== undefined) {
    if (!owned.includes(requested)) {
      return { auth: { token, user, stores: owned }, errorResponse: codeError("STORE_FORBIDDEN", "You do not have access to this store.", envelope) };
    }
    return { auth: { token, user, storeId: requested, stores: owned } };
  }

  // 5. absent
  if (scope === "required") {
    if (isImplicitDefaultEnabled() && owned.length === 1) {
      return { auth: { token, user, storeId: owned[0], stores: owned } };
    }
    return { auth: { token, user, stores: owned }, errorResponse: codeError("STORE_CONTEXT_REQUIRED", "No active store was specified for this request.", envelope) };
  }

  // 6. optional + absent
  return { auth: { token, user, stores: owned } };
}

// ── request construction ─────────────────────────────────────────────────────

/** Drops client-supplied store scoping; the route's own scope is applied afterwards. */
function isClientStoreKey(key: string): boolean {
  return key === "storeId" || /^where(\[[^\]]*\])*\[store\]/.test(key);
}

export async function proxyToBackend(req: NextRequest, options: ProxyOptions): Promise<NextResponse> {
  const logScope = options.logScope || "[proxy]";
  const authReq = options.auth ?? "dashboard";
  const requestId = newRequestId();

  const { auth, errorResponse } = await resolveDashboardAuth(req, authReq, {
    cookieName: options.cookieName,
    storeScope: options.storeScope,
    envelope: options.errorEnvelope,
  });
  if (errorResponse) return errorResponse;

  const envelope = Boolean(options.errorEnvelope) || authReq === "customer";

  if (options.guard) {
    const blocked = await options.guard(req, auth);
    if (blocked) return blocked;
  }

  const method = options.method || (req.method as ProxyMethod) || "GET";
  const path = typeof options.path === "function" ? options.path(req, auth) : options.path;

  // Upstream URL: forward the incoming query string, minus client store keys.
  const url = new URL(`${PAYLOAD_API_URL}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of new URL(req.url).searchParams.entries()) {
    if (isClientStoreKey(k)) continue;
    url.searchParams.set(k, v);
  }

  if (typeof options.params === "function") {
    options.params(url.searchParams, auth);
  } else if (options.params instanceof URLSearchParams) {
    for (const [k, v] of options.params.entries()) url.searchParams.set(k, v);
  } else if (options.params && typeof options.params === "object") {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { ...options.headers, "x-request-id": requestId };
  if (auth.token) {
    const prefix = options.authHeaderPrefix || (authReq === "customer" ? "Bearer" : "JWT");
    headers["Authorization"] = `${prefix} ${auth.token}`;
  }
  if (authReq === "dashboard" && auth.storeId) headers["x-store-id"] = auth.storeId;

  // ── body ───────────────────────────────────────────────────────────────────
  let body: BodyInit | undefined;

  if (method !== "GET" && (method as string) !== "HEAD") {
    let rawBody: unknown;

    if (options.body !== undefined) {
      if (typeof options.body === "function") {
        let incoming: unknown;
        try {
          incoming = await req.json();
        } catch {
          // incoming wasn't JSON or body was empty
        }
        try {
          rawBody = await options.body(incoming, auth);
        } catch (err) {
          if (err instanceof ProxyResponseError) return err.response;
          throw err;
        }
      } else {
        rawBody = options.body;
      }
    } else {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          rawBody = await req.json();
        } catch {
          return codeError("INVALID_BODY", "Invalid JSON body.", envelope);
        }
      } else if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData().catch(() => null);
        if (!formData) return codeError("INVALID_BODY", "Invalid form data.", envelope);
        rawBody = formData;
      }
    }

    // Unconditional store binding (replaces the old `role === "seller"` branches).
    const bindable =
      options.bindStore !== false &&
      authReq === "dashboard" &&
      Boolean(auth.storeId) &&
      (method === "POST" || method === "PATCH" || method === "PUT");
    if (bindable && isRecord(rawBody)) {
      rawBody = { ...rawBody, store: auth.storeId };
    }

    if (rawBody instanceof FormData) {
      body = rawBody;
    } else if (typeof rawBody === "string") {
      body = rawBody;
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    } else if (rawBody !== undefined) {
      body = JSON.stringify(rawBody);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
  }

  // ── upstream call ──────────────────────────────────────────────────────────
  let res: Response;
  try {
    res = await fetch(url.toString(), { method, headers, body, cache: options.cache ?? "no-store" });
  } catch (err) {
    // Genuine network failure only — never used for 4xx/5xx from a reachable backend.
    console.error(`${logScope} [${requestId}] Failed to reach seller-backend at ${url.pathname}:`, err);
    if (options.onError) return options.onError(err);
    return apiError(502, "BACKEND_OFFLINE", "Could not reach the backend. Please try again.", { envelope, requestId });
  }

  const resContentType = res.headers.get("content-type") || "";
  const isJson = resContentType.includes("application/json");

  if (!res.ok) {
    return normalizeUpstreamError(res, isJson, envelope, requestId);
  }

  try {
    if (isJson) {
      const data: unknown = await res.json();
      if (options.responseHandler) return await options.responseHandler(res, data);
      return NextResponse.json(data, { status: res.status, headers: { "x-request-id": requestId } });
    }

    // Pass through non-JSON responses (e.g. PDFs, streams)
    const blob = await res.blob();
    const forwardHeaders: Record<string, string> = { "x-request-id": requestId };
    if (resContentType) forwardHeaders["content-type"] = resContentType;
    const contentDisposition = res.headers.get("content-disposition");
    if (contentDisposition) forwardHeaders["content-disposition"] = contentDisposition;
    return new NextResponse(blob, { status: res.status, headers: forwardHeaders });
  } catch (err) {
    console.error(`${logScope} [${requestId}] Unreadable upstream response from ${url.pathname}:`, err);
    return apiError(502, "UPSTREAM_ERROR", "The backend returned an unreadable response.", { envelope, requestId });
  }
}

type PathArg = string | ((req: NextRequest, auth: ProxyAuthResult) => string);

/** Shorthand for GET proxy requests. */
export function proxyGet(req: NextRequest, path: PathArg, options: Omit<ProxyOptions, "path" | "method"> = {}): Promise<NextResponse> {
  return proxyToBackend(req, { ...options, path, method: "GET" });
}

/** Shorthand for POST proxy requests. */
export function proxyPost(req: NextRequest, path: PathArg, options: Omit<ProxyOptions, "path" | "method"> = {}): Promise<NextResponse> {
  return proxyToBackend(req, { ...options, path, method: "POST" });
}

/** Shorthand for PATCH proxy requests. */
export function proxyPatch(req: NextRequest, path: PathArg, options: Omit<ProxyOptions, "path" | "method"> = {}): Promise<NextResponse> {
  return proxyToBackend(req, { ...options, path, method: "PATCH" });
}

/** Shorthand for DELETE proxy requests. */
export function proxyDelete(req: NextRequest, path: PathArg, options: Omit<ProxyOptions, "path" | "method"> = {}): Promise<NextResponse> {
  return proxyToBackend(req, { ...options, path, method: "DELETE" });
}
