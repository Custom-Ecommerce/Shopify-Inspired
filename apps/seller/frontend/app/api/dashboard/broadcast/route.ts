import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** Phase 7.7 — POST /api/dashboard/broadcast: forwards to admin-backend's `/api/stores/:id/broadcast` */
export function POST(req: NextRequest) {
  return proxyPost(req, (_req, auth) => `/api/stores/${auth.storeId}/broadcast`, {
    auth: "dashboard",
    bindStore: false, // custom endpoint; store comes from the path + x-store-id
    logScope: "[api/dashboard/broadcast]",
  });
}

