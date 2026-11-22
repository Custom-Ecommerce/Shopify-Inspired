import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * POST /api/proxy/domain/verify
 *
 * Forwards to the Seller backend's `POST /api/stores/:id/domain/verify`. S7-B5: the backend body is strict and empty, because the DNS
 * check is made there and a result is never taken from the browser. Whatever the browser sends is dropped; the store is the active one.
 */
export function POST(req: NextRequest) {
  return proxyPost(req, (_req, auth) => `/api/stores/${encodeURIComponent(auth.storeId ?? "")}/domain/verify`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy domain/verify]",
    body: () => ({}),
  });
}
