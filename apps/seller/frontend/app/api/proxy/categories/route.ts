import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * GET /api/proxy/categories — the marketplace-wide category taxonomy (read-only, replicated from
 * Admin). Requires a signed-in seller; no store scoping is needed, so an active store is
 * honoured if sent but never required. The query string (`limit`, `depth`, …) is forwarded.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/categories", {
    auth: "dashboard",
    storeScope: "optional",
    logScope: "[proxy categories]",
  });
}
