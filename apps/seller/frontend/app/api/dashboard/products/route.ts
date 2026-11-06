import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/**
 * Phase 7.4 — GET /api/dashboard/products
 *
 * Auth + store-scoped list. The query string (q, status, sort, stock, page,
 * limit) is forwarded, and the verified store travels as `x-store-id`. Used by
 * client components (Inventory) that need "my store's products" without the
 * Server-Component-only direct fetch the Products/Overview pages use.
 */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/products", {
    auth: "dashboard",
    logScope: "[api/dashboard/products]",
    params: (params) => {
      if (!params.has("limit")) params.set("limit", "50");
    },
  });
}

/**
 * Phase 7.4 — POST /api/dashboard/products
 *
 * The proxy resolves + verifies the active store (`x-store-id` ∈ user.stores)
 * and forwards it; the backend checks it again. `bindStore` is off because the
 * product contract refuses a `store` in the body.
 */
export async function POST(req: NextRequest) {
  return proxyPost(req, "/api/products", {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/products]",
  });
}
