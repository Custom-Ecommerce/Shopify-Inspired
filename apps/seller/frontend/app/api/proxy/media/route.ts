import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/**
 * POST /api/proxy/media — multipart upload (`file`, `alt`) to the Seller backend's `/api/media`.
 *
 * The active store is resolved from `x-store-id` and verified against `user.stores` by the
 * shared proxy, which forwards the verified id upstream. The `media` collection's `bindStore`
 * hook reads that header on create, so no `store` field is injected into the multipart body.
 */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/media", {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy media]",
  });
}

/**
 * GET /api/proxy/media (Sprint 7, S7-B2) — the active store's files, newest first, in the list envelope (`page` and `limit` pass through). The media
 * library page reads this; the store comes from `x-store-id`, verified by the proxy.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/media", {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy media]",
  });
}
