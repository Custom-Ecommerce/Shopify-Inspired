import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/** Phase 7.6 — GET list / POST create, store-scoped, same pattern as /api/dashboard/products. */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/discounts", {
    auth: "dashboard",
    logScope: "[api/dashboard/discounts]",
    params: (params, auth) => {
      if (auth.storeId) params.set("where[store][equals]", auth.storeId);
      if (!params.has("limit")) params.set("limit", "50");
      if (!params.has("sort")) params.set("sort", "-createdAt");
    },
  });
}

export async function POST(req: NextRequest) {
  return proxyPost(req, "/api/discounts", {
    auth: "dashboard",
    logScope: "[api/dashboard/discounts]",
  });
}
