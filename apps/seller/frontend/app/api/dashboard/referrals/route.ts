import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** Phase 7.7 — GET /api/dashboard/referrals: the seller's own store as referrer */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/referrals", {
    auth: "dashboard",
    params: (searchParams, auth) => {
      if (auth.storeId) {
        searchParams.set("where[referrer][equals]", auth.storeId);
      }
      searchParams.set("limit", "100");
      searchParams.set("depth", "1");
    },
    logScope: "[api/dashboard/referrals]",
  });
}

