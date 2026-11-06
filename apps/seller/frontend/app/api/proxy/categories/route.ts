import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/**
 * GET /api/proxy/categories — the active store's categories. The query string (`limit`, `page`, …) is forwarded.
 * POST /api/proxy/categories — creates one in that store.
 *
 * The proxy verifies `x-store-id` against the seller's stores and forwards it; the backend checks it again. `bindStore`
 * is off because the category contracts refuse a `store` field: the store comes from the header, never from the body.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/categories", {
    auth: "dashboard",
    storeScope: "required",
    logScope: "[proxy categories]",
  });
}

export function POST(req: NextRequest) {
  return proxyPost(req, "/api/categories", {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy categories]",
  });
}
