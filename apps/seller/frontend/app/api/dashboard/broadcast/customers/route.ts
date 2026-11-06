import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** Phase 7.7 — GET /api/dashboard/broadcast/customers?sinceDays=30: forwards to admin-backend's `/api/stores/:id/customers` */
export function GET(req: NextRequest) {
  return proxyGet(req, (_req, auth) => `/api/stores/${auth.storeId}/customers`, {
    auth: "dashboard",
    params: (searchParams) => {
      const sinceDays = req.nextUrl.searchParams.get("sinceDays");
      if (sinceDays) searchParams.set("sinceDays", sinceDays);
    },
    logScope: "[api/dashboard/broadcast/customers]",
  });
}

