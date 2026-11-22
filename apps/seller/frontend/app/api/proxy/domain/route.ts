import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/proxy/domain: the domain page's state (records, status, failure reason) of the active store. The backend re-checks ownership. */
export function GET(req: NextRequest) {
  return proxyGet(req, (_req, auth) => `/api/stores/${encodeURIComponent(auth.storeId ?? "")}/domain`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy domain]",
  });
}
