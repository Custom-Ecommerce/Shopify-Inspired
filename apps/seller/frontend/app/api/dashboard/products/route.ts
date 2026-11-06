import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/**
 * Phase 7.4 — GET /api/dashboard/products
 *
 * Auth + store-scoped list, forwarded query string appended (so callers
 * can add `sort=stockQuantity` etc — see the Inventory page). Used by
 * client components (Inventory) that need "my store's products" without
 * the Server-Component-only `getDashboardSession`/direct-fetch approach
 * the Products/Overview pages use.
 */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/products", {
    auth: "dashboard",
    logScope: "[api/dashboard/products]",
    params: (params, auth) => {
      if (auth.storeId) params.set("where[store][equals]", auth.storeId);
      if (!params.has("limit")) params.set("limit", "50");
    },
  });
}

/**
 * Phase 7.4 — POST /api/dashboard/products
 *
 * The proxy resolves + verifies the active store (`x-store-id` ∈ user.stores)
 * and unconditionally sets `body.store = auth.storeId`; any client-sent
 * `store` is overwritten. The backend independently rejects a mismatch
 * (`STORE_MISMATCH`, §5.2) — defence in depth.
 */
export async function POST(req: NextRequest) {
  return proxyPost(req, "/api/products", {
    auth: "dashboard",
    logScope: "[api/dashboard/products]",
  });
}
