import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/earnings: store resolved + verified by the proxy, forwarded to the Seller backend's `/api/stores/:id/earnings`. */
export async function GET(req: NextRequest) {
  return proxyGet(req, (_req, auth) => `/api/stores/${auth.storeId}/earnings`, {
    auth: "dashboard",
    logScope: "[api/dashboard/earnings]",
  });
}
