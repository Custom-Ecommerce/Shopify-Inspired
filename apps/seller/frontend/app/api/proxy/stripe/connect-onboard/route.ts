import { NextRequest } from "next/server";
import { apiError, proxyPost, ProxyResponseError, type ProxyAuthResult } from "@/lib/proxy";

/**
 * POST /api/proxy/stripe/connect-onboard
 *
 * Blueprint §5.6 / §6.4: this route no longer talks to the Admin. It forwards
 * to the Seller backend's `POST /api/stores/:id/billing/onboard`, which checks
 * ownership and the store's status and then calls the Admin with
 * `INTERNAL_SERVICE_SECRET`. The frontend therefore holds neither
 * `INTERNAL_SERVICE_SECRET` nor `ADMIN_BACKEND_API_URL`.
 *
 * The path id is the store verified by the shared resolver (`x-store-id`
 * checked against `user.stores`); the body `storeId` must equal it.
 */
export async function POST(req: NextRequest) {
  return proxyPost(
    req,
    (_req, auth) => `/api/stores/${encodeURIComponent(auth.storeId ?? "")}/billing/onboard`,
    {
      auth: "dashboard",
      storeScope: "required",
      bindStore: false, // not a store-owned collection document
      logScope: "[proxy stripe]",
      body: (incoming: unknown, auth: ProxyAuthResult) => {
        const storeId = (incoming as { storeId?: unknown } | null | undefined)?.storeId;
        if (typeof storeId !== "string" || !storeId) {
          throw new ProxyResponseError(apiError(400, "INVALID_BODY", "storeId is required"));
        }
        if (storeId !== auth.storeId) {
          throw new ProxyResponseError(apiError(403, "STORE_FORBIDDEN", "You do not have access to this store."));
        }

        const origin = req.headers.get("origin") || process.env.SELLER_PORTAL_URL || "http://localhost:3002";
        // Pages live under /s/[storeId] (Phase 6B): return to THIS store's billing page.
        return { returnUrl: `${origin.replace(/\/+$/, "")}/s/${encodeURIComponent(storeId)}/billing` };
      },
    }
  );
}
