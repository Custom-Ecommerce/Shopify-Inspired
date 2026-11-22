import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/**
 * Sprint 7 (S7-B4): the seller's own support tickets. A ticket belongs to the seller, not to a store, so no store is required (`storeScope: "optional"`).
 * `bindStore` is off: the create body is strict ({ subject, message, orderRef? }), a `store` field added by the proxy would be a 400.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/tickets", { auth: "dashboard", storeScope: "optional", bindStore: false, logScope: "[api/dashboard/tickets]" });
}

export function POST(req: NextRequest) {
  return proxyPost(req, "/api/tickets", { auth: "dashboard", storeScope: "optional", bindStore: false, logScope: "[api/dashboard/tickets]" });
}
