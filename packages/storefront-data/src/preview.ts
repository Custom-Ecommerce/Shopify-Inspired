import {
  PREVIEW_COOKIE_NAME,
  PREVIEW_CREDENTIAL_HEADER,
  PREVIEW_QUERY_PARAM,
  PREVIEW_TOKEN_TTL_SECONDS,
} from "@markaz/platform-kit/preview";

/*
 * Preview handling on the storefront side (D-018, D-019, D-029). Pure apart from the one injected fetch, and free of
 * Next.js and React, so the edge middleware and the server routes share it. This file never decides whether a token is
 * valid: the secret stays in the seller backend, which is asked.
 */

/** What every response made for a preview says about caching. */
export const PREVIEW_CACHE_CONTROL = "private, no-store";

const STORE_BY_KEY_PATH = "/api/storefront/v1/stores/by-key/";
const CHECK_TIMEOUT_MS = 4000;

/**
 * How long a token still has, in seconds, read from its own expiry and capped at the 24 hours a token can have. For the
 * cookie's lifetime only, and only after the backend has accepted the token. Zero for anything unreadable.
 */
export function previewSecondsLeft(token: string, nowMs: number): number {
  const payload = token.split(".")[1] ?? "";
  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const exp = (decoded as { exp?: unknown } | null)?.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return 0;
    return Math.max(0, Math.min(Math.floor(exp - nowMs / 1000), PREVIEW_TOKEN_TTL_SECONDS));
  } catch {
    return 0;
  }
}

/** Host-only: no Domain attribute, so a browser sends it back to the one store host that set it and to no other. */
export function previewCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return (
    PREVIEW_COOKIE_NAME + "=" + token + "; Path=/; Max-Age=" + maxAgeSeconds + "; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "")
  );
}

/** The same cookie, expired. Path and scope have to match for a browser to drop it. */
export function clearedPreviewCookie(secure: boolean): string {
  return PREVIEW_COOKIE_NAME + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "");
}

/**
 * The path and query to go to once the token is off the URL. Leading slashes collapse to one, so a path like //evil.test
 * can never become a redirect to another host.
 */
export function withoutPreviewParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PREVIEW_QUERY_PARAM);
  const rest = params.toString();
  return "/" + pathname.replace(/^\/+/, "") + (rest === "" ? "" : "?" + rest);
}

export interface PreviewCheckInput {
  /** Seller backend origin. */
  baseUrl: string;
  /** The store label of the host the link was opened on. */
  storeKey: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/** Does the seller backend accept this token for this store? Anything but a clear yes, a failure included, is no. */
export async function confirmPreviewToken(input: PreviewCheckInput): Promise<boolean> {
  const fetchImpl: typeof fetch = input.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const base = input.baseUrl.replace(/\/+$/, "");
  try {
    const response = await fetchImpl(base + STORE_BY_KEY_PATH + encodeURIComponent(input.storeKey) + "?by=slug", {
      method: "GET",
      headers: { accept: "application/json", [PREVIEW_CREDENTIAL_HEADER]: input.token },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (body as { preview?: unknown } | null)?.preview === true;
  } catch {
    return false;
  }
}
