import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/commission: the commission rate that applies to the active store, forwarded to `/api/stores/:id/commission` (read only). */
export async function GET(req: NextRequest) {
  return proxyGet(req, (_req, auth) => `/api/stores/${auth.storeId}/commission`, {
    auth: "dashboard",
    logScope: "[api/dashboard/commission]",
  });
}
