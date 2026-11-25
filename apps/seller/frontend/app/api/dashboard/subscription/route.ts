import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * GET /api/dashboard/subscription (Sprint 6 EP-14, S6-B4): the signed-in seller's own subscription, open payment and payment history. The plan
 * belongs to the seller, not to a store, so the proxy needs the session only (no store is resolved).
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/subscription", { auth: "token", logScope: "[api/dashboard/subscription]" });
}
