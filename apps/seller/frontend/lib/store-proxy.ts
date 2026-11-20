import type { NextRequest } from "next/server";
import { apiError, proxyGet, proxyPost, ProxyResponseError, type ProxyAuthResult } from "@/lib/proxy";

/** The path id must be the verified active store, as for PATCH /api/proxy/stores/:id. */
export function ownStoreGuard(id: string) {
  return (_req: NextRequest, auth: ProxyAuthResult) =>
    auth.storeId !== id ? apiError(403, "STORE_FORBIDDEN", "You do not have access to this store.") : null;
}

/** GET /api/proxy/stores/:id/<tail> -> the seller backend's GET /api/stores/:id/<tail> (settings, readiness). */
export function proxyStoreGet(req: NextRequest, id: string, tail: string, logScope: string) {
  return proxyGet(req, `/api/stores/${encodeURIComponent(id)}/${tail}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope,
    guard: ownStoreGuard(id),
  });
}

/** POST /api/proxy/stores/:id/<tail> -> the seller backend's POST /api/stores/:id/<tail> (go-live). No body is forwarded from the browser. */
export function proxyStorePost(req: NextRequest, id: string, tail: string, logScope: string) {
  return proxyPost(req, `/api/stores/${encodeURIComponent(id)}/${tail}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope,
    guard: ownStoreGuard(id),
    body: () => ({}),
  });
}

/**
 * POST /api/proxy/stores/:id/<tail> with the browser's JSON body forwarded as it is (broadcast preview and send). The backend
 * validates every field; here only "a JSON object" is required.
 */
export function proxyStorePostBody(req: NextRequest, id: string, tail: string, logScope: string) {
  return proxyPost(req, `/api/stores/${encodeURIComponent(id)}/${tail}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope,
    guard: ownStoreGuard(id),
    body: (incoming: unknown) => {
      if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
        throw new ProxyResponseError(apiError(400, "INVALID_BODY", "Expected a JSON object body."));
      }
      return incoming;
    },
  });
}
