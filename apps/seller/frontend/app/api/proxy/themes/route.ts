import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/proxy/themes: the themes a store can choose (slug, name, tier, preview image). */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/themes", { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[proxy themes]" });
}
