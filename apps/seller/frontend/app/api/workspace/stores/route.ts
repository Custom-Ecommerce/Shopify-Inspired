import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * POST /api/workspace/stores   body: { name }
 *
 * Forwards to the Seller backend's provisioning endpoint. The seller does not own any store yet
 * (or is creating an additional one), so no store context is resolved or bound: authentication
 * only (`storeScope: "none"`, `bindStore: false`). Upstream error codes (STORE_LIMIT_REACHED,
 * ACCOUNT_SUSPENDED, SELLER_NOT_SYNCED, …) are preserved by the proxy's error normaliser.
 */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/workspace/stores", {
    auth: "dashboard",
    storeScope: "none",
    bindStore: false,
    logScope: "[proxy workspace/stores]",
  });
}
