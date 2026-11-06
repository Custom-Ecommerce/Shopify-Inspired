import { NextRequest } from "next/server";
import { apiError, proxyPost, ProxyResponseError, type ProxyAuthResult } from "@/lib/proxy";

/**
 * POST /api/proxy/domain/verify   body: { storeId?, domain? }
 *
 * Forwards to the Seller backend's `POST /api/stores/:id/domain/verify` (ownership + class C7
 * re-checked there). A body `storeId`, if present, must equal the verified active store.
 */
export function POST(req: NextRequest) {
  return proxyPost(req, (_req, auth) => `/api/stores/${encodeURIComponent(auth.storeId ?? "")}/domain/verify`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy domain/verify]",
    body: (incoming: unknown, auth: ProxyAuthResult) => {
      const rec = typeof incoming === "object" && incoming !== null && !Array.isArray(incoming) ? (incoming as Record<string, unknown>) : {};
      if (rec.storeId !== undefined && String(rec.storeId) !== auth.storeId) {
        throw new ProxyResponseError(apiError(403, "STORE_FORBIDDEN", "You do not have access to this store."));
      }
      return typeof rec.domain === "string" && rec.domain.trim() !== "" ? { domain: rec.domain } : {};
    },
  });
}
