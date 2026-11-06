import { NextRequest } from "next/server";
import { apiError, proxyPost, ProxyResponseError, type ProxyAuthResult } from "@/lib/proxy";

/**
 * POST /api/proxy/domain/connect   body: { storeId?, domain }
 *
 * Forwards to the Seller backend's `POST /api/stores/:id/domain/connect`, which re-checks
 * ownership and operation class C7. The path id is the store verified by the shared resolver
 * (`x-store-id` against `user.stores`); a body `storeId`, if present, must equal it.
 */
export function POST(req: NextRequest) {
  return proxyPost(req, (_req, auth) => `/api/stores/${encodeURIComponent(auth.storeId ?? "")}/domain/connect`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy domain/connect]",
    body: (incoming: unknown, auth: ProxyAuthResult) => {
      const rec = typeof incoming === "object" && incoming !== null && !Array.isArray(incoming) ? (incoming as Record<string, unknown>) : null;
      if (!rec || typeof rec.domain !== "string" || rec.domain.trim() === "") {
        throw new ProxyResponseError(apiError(400, "INVALID_BODY", "domain is required."));
      }
      if (rec.storeId !== undefined && String(rec.storeId) !== auth.storeId) {
        throw new ProxyResponseError(apiError(403, "STORE_FORBIDDEN", "You do not have access to this store."));
      }
      return { domain: rec.domain };
    },
  });
}
