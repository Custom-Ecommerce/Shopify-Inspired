import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/proxy/domain/disconnect: no body. The backend removes the host from the hosting project and clears the store's domain. */
export function POST(req: NextRequest) {
  return proxyPost(req, (_req, auth) => `/api/stores/${encodeURIComponent(auth.storeId ?? "")}/domain/disconnect`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy domain/disconnect]",
    body: () => ({}),
  });
}
