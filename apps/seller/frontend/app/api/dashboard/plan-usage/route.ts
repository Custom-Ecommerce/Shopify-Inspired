import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/plan-usage (Sprint 6 EP-14.US02): store resolved + verified by the proxy, forwarded to `/api/stores/:id/plan-usage`. */
export async function GET(req: NextRequest) {
  return proxyGet(req, (_req, auth) => `/api/stores/${auth.storeId}/plan-usage`, {
    auth: "dashboard",
    logScope: "[api/dashboard/plan-usage]",
  });
}
