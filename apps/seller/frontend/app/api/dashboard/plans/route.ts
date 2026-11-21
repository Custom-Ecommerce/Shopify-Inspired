import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * GET /api/dashboard/plans (Sprint 6 EP-14.US01.T07): the active subscription plans, forwarded to the Seller backend's /api/plans. They belong
 * to no store, so the proxy only needs the signed-in session (no store is resolved).
 */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/plans", { auth: "token", logScope: "[api/dashboard/plans]" });
}
