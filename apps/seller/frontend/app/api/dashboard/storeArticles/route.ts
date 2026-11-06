import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/** Phase 7.7 â€” GET list / POST create, store-scoped */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/storeArticles", {
    auth: "dashboard",
    params: (searchParams, auth) => {
      if (auth.storeId) searchParams.set("where[store][equals]", auth.storeId);
      if (!searchParams.has("limit")) searchParams.set("limit", "50");
      if (!searchParams.has("sort")) searchParams.set("sort", "-createdAt");
    },
    logScope: "[api/dashboard/storeArticles]",
  });
}

export function POST(req: NextRequest) {
  return proxyPost(req, "/api/storeArticles", {
    auth: "dashboard",
    logScope: "[api/dashboard/storeArticles]",
  });
}


