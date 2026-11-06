import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

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
