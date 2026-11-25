import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * GET /api/dashboard/contactMessages (Sprint 7, S7-B4): the active store's contact inbox, newest first (`status`, `page` and `limit` pass through).
 * `?status=new&limit=1` is the unread count (`totalDocs`) the navigation shows. The store comes from `x-store-id`, verified by the proxy.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/contactMessages", { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/contactMessages]" });
}
