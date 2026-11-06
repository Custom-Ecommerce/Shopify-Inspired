import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** Phase 7.5 — GET /api/dashboard/reviews: auth + store-scoped list */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/reviews", {
    auth: "dashboard",
    params: (searchParams, auth) => {
      if (auth.storeId) searchParams.set("where[store][equals]", auth.storeId);
      if (!searchParams.has("limit")) searchParams.set("limit", "50");
      if (!searchParams.has("sort")) searchParams.set("sort", "-createdAt");
      searchParams.set("depth", "1");
    },
    logScope: "[api/dashboard/reviews]",
  });
}

